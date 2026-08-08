use base64::{engine::general_purpose::STANDARD, Engine as _};
use hmac::{Hmac, Mac};
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use reqwest::header::CONTENT_TYPE;
use serde_json::Value;
use sha1::Sha1;
use std::{
    collections::BTreeMap,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use time::{format_description, OffsetDateTime};

use crate::{
    pagination::PageNumberPager, provider_http_client, ActionResult, CloudConfig, DnsRecord,
    DomainSummary, RecordInput, VerifyResult, DEFAULT_STATUS, PROVIDER_ALIYUN,
};

type HmacSha1 = Hmac<Sha1>;
type RpcParameters = BTreeMap<String, String>;

const VERSION: &str = "2015-01-09";
const DOMAIN_PAGE_SIZE: u64 = 100;
const RECORD_PAGE_SIZE: u64 = 500;
const CONTENT_TYPE_FORM: &str = "application/x-www-form-urlencoded";
const ALIYUN_ENCODE_SET: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'~');
static NONCE_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(crate) async fn verify(config: &CloudConfig) -> Result<VerifyResult, String> {
    let (domains, request_id) = list_domains(config).await?;

    Ok(VerifyResult {
        ok: true,
        message: "阿里云 DNS 连接成功，AccessKey 和权限可用".to_string(),
        request_id,
        domain_count: Some(domains.len() as u64),
        domains,
    })
}

pub(crate) async fn list_records(
    config: &CloudConfig,
    domain: &str,
) -> Result<Vec<DnsRecord>, String> {
    let mut records = Vec::new();
    let mut pager = PageNumberPager::default();
    let mut total = None;

    loop {
        let response = call_dns(
            config,
            "DescribeDomainRecords",
            parameters([
                ("DomainName", domain.trim().to_string()),
                ("PageNumber", pager.page().to_string()),
                ("PageSize", RECORD_PAGE_SIZE.to_string()),
            ]),
        )
        .await?;
        total = value_as_u64_optional(&response, "TotalCount").or(total);
        let page = response
            .pointer("/DomainRecords/Record")
            .and_then(Value::as_array)
            .map(|items| items.iter().map(record_summary).collect::<Vec<_>>())
            .unwrap_or_default();
        let has_next = pager.advance(page.len(), None, total, "阿里云解析记录")?;
        records.extend(page);
        if !has_next {
            break;
        }
    }

    Ok(records)
}

pub(crate) async fn create_record(
    config: &CloudConfig,
    input: &RecordInput,
) -> Result<ActionResult, String> {
    let mut payload = record_parameters(input);
    payload.insert("DomainName".to_string(), input.domain.clone());
    let response = call_dns(config, "AddDomainRecord", payload).await?;
    let record_id = value_as_string(&response, "RecordId");

    if !record_id.is_empty() {
        if !input.status.eq_ignore_ascii_case(DEFAULT_STATUS) {
            set_record_status(config, &record_id, &input.status).await?;
        }
        if !input.remark.is_empty() {
            update_record_remark(config, &record_id, &input.remark).await?;
        }
    }

    Ok(ActionResult {
        ok: true,
        message: "解析记录已新增".to_string(),
        request_id: request_id(&response),
        record_id: (!record_id.is_empty()).then_some(record_id),
    })
}

pub(crate) async fn update_record(
    config: &CloudConfig,
    input: &RecordInput,
    record_id: &str,
) -> Result<ActionResult, String> {
    ensure_record_belongs_to_domain(config, &input.domain, record_id).await?;
    let mut payload = record_parameters(input);
    payload.insert("RecordId".to_string(), record_id.trim().to_string());
    let response = call_dns(config, "UpdateDomainRecord", payload).await?;
    set_record_status(config, record_id, &input.status).await?;
    update_record_remark(config, record_id, &input.remark).await?;

    Ok(ActionResult {
        ok: true,
        message: "解析记录已修改".to_string(),
        request_id: request_id(&response),
        record_id: Some(record_id.trim().to_string()),
    })
}

pub(crate) async fn delete_record(
    config: &CloudConfig,
    domain: &str,
    record_id: &str,
) -> Result<ActionResult, String> {
    ensure_record_belongs_to_domain(config, domain, record_id).await?;
    let response = call_dns(
        config,
        "DeleteDomainRecord",
        parameters([("RecordId", record_id.trim().to_string())]),
    )
    .await?;

    Ok(ActionResult {
        ok: true,
        message: "解析记录已删除".to_string(),
        request_id: request_id(&response),
        record_id: Some(record_id.trim().to_string()),
    })
}

async fn list_domains(
    config: &CloudConfig,
) -> Result<(Vec<DomainSummary>, Option<String>), String> {
    let mut domains = Vec::new();
    let mut pager = PageNumberPager::default();
    let mut total = None;
    let mut first_request_id = None;

    loop {
        let response = call_dns(
            config,
            "DescribeDomains",
            parameters([
                ("PageNumber", pager.page().to_string()),
                ("PageSize", DOMAIN_PAGE_SIZE.to_string()),
            ]),
        )
        .await?;
        if first_request_id.is_none() {
            first_request_id = request_id(&response);
        }
        total = value_as_u64_optional(&response, "TotalCount").or(total);
        let page = response
            .pointer("/Domains/Domain")
            .and_then(Value::as_array)
            .map(|items| items.iter().map(domain_summary).collect::<Vec<_>>())
            .unwrap_or_default();
        let has_next = pager.advance(page.len(), None, total, "阿里云域名")?;
        domains.extend(page);
        if !has_next {
            break;
        }
    }

    Ok((domains, first_request_id))
}

async fn ensure_record_belongs_to_domain(
    config: &CloudConfig,
    domain: &str,
    record_id: &str,
) -> Result<(), String> {
    let belongs = list_records(config, domain)
        .await?
        .iter()
        .any(|record| record.record_id == record_id.trim());
    if belongs {
        Ok(())
    } else {
        Err(format!(
            "记录 {record_id} 不属于当前域名 {domain}，已拒绝操作"
        ))
    }
}

async fn set_record_status(
    config: &CloudConfig,
    record_id: &str,
    status: &str,
) -> Result<(), String> {
    call_dns(
        config,
        "SetDomainRecordStatus",
        parameters([
            ("RecordId", record_id.trim().to_string()),
            ("Status", normalize_status(status)),
        ]),
    )
    .await?;
    Ok(())
}

async fn update_record_remark(
    config: &CloudConfig,
    record_id: &str,
    remark: &str,
) -> Result<(), String> {
    call_dns(
        config,
        "UpdateDomainRecordRemark",
        parameters([
            ("RecordId", record_id.trim().to_string()),
            ("Remark", remark.to_string()),
        ]),
    )
    .await?;
    Ok(())
}

async fn call_dns(
    config: &CloudConfig,
    action: &str,
    business_parameters: RpcParameters,
) -> Result<Value, String> {
    let timestamp = request_timestamp()?;
    let nonce = request_nonce()?;
    let signed = signed_parameters(config, action, business_parameters, &timestamp, &nonce)?;
    let body = canonicalized_query(&parameter_pairs(&signed));
    let endpoint = config.endpoint.trim().trim_end_matches('/');

    let response = provider_http_client()?
        .post(endpoint)
        .header(CONTENT_TYPE, CONTENT_TYPE_FORM)
        .body(body)
        .send()
        .await
        .map_err(|error| format!("请求阿里云 DNS 失败：{error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取阿里云 DNS 响应失败：{error}"))?;
    let value = serde_json::from_str::<Value>(&text)
        .map_err(|error| format!("阿里云 DNS 响应不是合法 JSON：{error}; 原始响应：{text}"))?;

    if let Some(error) = response_error(&value) {
        return Err(error);
    }
    if !status.is_success() {
        return Err(format!("阿里云 DNS 返回 HTTP {status}: {text}"));
    }

    Ok(value)
}

fn signed_parameters(
    config: &CloudConfig,
    action: &str,
    mut business_parameters: RpcParameters,
    timestamp: &str,
    nonce: &str,
) -> Result<RpcParameters, String> {
    business_parameters.insert(
        "AccessKeyId".to_string(),
        config.secret_id.trim().to_string(),
    );
    business_parameters.insert("Action".to_string(), action.to_string());
    business_parameters.insert("Format".to_string(), "JSON".to_string());
    business_parameters.insert("SignatureMethod".to_string(), "HMAC-SHA1".to_string());
    business_parameters.insert("SignatureNonce".to_string(), nonce.to_string());
    business_parameters.insert("SignatureVersion".to_string(), "1.0".to_string());
    business_parameters.insert("Timestamp".to_string(), timestamp.to_string());
    business_parameters.insert("Version".to_string(), VERSION.to_string());

    let canonical = canonicalized_query(&parameter_pairs(&business_parameters));
    let string_to_sign = format!("POST&%2F&{}", percent_encode(&canonical));
    let signing_key = format!("{}&", config.secret_key.trim());
    let signature = hmac_sha1_base64(signing_key.as_bytes(), &string_to_sign)?;
    business_parameters.insert("Signature".to_string(), signature);
    Ok(business_parameters)
}

fn record_parameters(input: &RecordInput) -> RpcParameters {
    let mut payload = parameters([
        ("RR", input.sub_domain.clone()),
        ("Type", input.record_type.clone()),
        ("Value", input.value.clone()),
        ("TTL", input.ttl.unwrap_or(600).to_string()),
        ("Line", api_line(&input.record_line)),
    ]);
    if input.record_type.eq_ignore_ascii_case("MX") {
        if let Some(priority) = input.mx.filter(|value| *value > 0) {
            payload.insert("Priority".to_string(), priority.to_string());
        }
    }
    payload
}

fn parameters<const N: usize>(items: [(&str, String); N]) -> RpcParameters {
    items
        .into_iter()
        .map(|(key, value)| (key.to_string(), value))
        .collect()
}

fn parameter_pairs(parameters: &RpcParameters) -> Vec<(String, String)> {
    parameters
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

fn canonicalized_query(parameters: &[(String, String)]) -> String {
    let mut sorted = parameters.to_vec();
    sorted.sort_by(|left, right| left.0.cmp(&right.0).then(left.1.cmp(&right.1)));
    sorted
        .iter()
        .map(|(key, value)| format!("{}={}", percent_encode(key), percent_encode(value)))
        .collect::<Vec<_>>()
        .join("&")
}

fn percent_encode(value: &str) -> String {
    utf8_percent_encode(value, ALIYUN_ENCODE_SET).to_string()
}

fn hmac_sha1_base64(key: &[u8], message: &str) -> Result<String, String> {
    let mut mac =
        HmacSha1::new_from_slice(key).map_err(|error| format!("HMAC 初始化失败：{error}"))?;
    mac.update(message.as_bytes());
    Ok(STANDARD.encode(mac.finalize().into_bytes()))
}

fn request_timestamp() -> Result<String, String> {
    let format =
        format_description::parse_borrowed::<3>("[year]-[month]-[day]T[hour]:[minute]:[second]Z")
            .map_err(|error| format!("时间格式初始化失败：{error}"))?;
    OffsetDateTime::now_utc()
        .format(&format)
        .map_err(|error| format!("时间格式化失败：{error}"))
}

fn request_nonce() -> Result<String, String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("系统时间无效：{error}"))?
        .as_nanos();
    let counter = NONCE_COUNTER.fetch_add(1, Ordering::Relaxed);
    Ok(format!("domain-buddy-{nanos:x}-{counter:x}"))
}

fn api_line(line: &str) -> String {
    match line.trim() {
        "" | "默认" | "default" => "default".to_string(),
        value => value.to_string(),
    }
}

fn normalize_status(status: &str) -> String {
    if status.eq_ignore_ascii_case("DISABLE") {
        "DISABLE".to_string()
    } else {
        DEFAULT_STATUS.to_string()
    }
}

fn domain_summary(item: &Value) -> DomainSummary {
    let domain_name = value_as_string(item, "DomainName");
    let domain_id = value_as_string(item, "DomainId");
    let status = match item.get("AliDomain").and_then(Value::as_bool) {
        Some(true) => "阿里云 DNS",
        Some(false) => "外部域名",
        None => "可用",
    };

    DomainSummary {
        domain_id: if domain_id.is_empty() {
            domain_name.clone()
        } else {
            domain_id
        },
        provider: PROVIDER_ALIYUN.to_string(),
        provider_label: "阿里云 DNS".to_string(),
        name: domain_name,
        status: status.to_string(),
        dns_status: String::new(),
        grade_title: first_non_empty(item, &["VersionName", "GroupName"]),
        record_count: value_as_u64(item, "RecordCount"),
        remark: value_as_string(item, "Remark"),
        updated_on: first_non_empty(item, &["UpdateTime", "CreateTime"]),
    }
}

fn record_summary(item: &Value) -> DnsRecord {
    let line = value_as_string(item, "Line");
    let line_id = first_non_empty(item, &["LineCode", "LineId"]);
    let status = normalize_status(&value_as_string(item, "Status"));
    DnsRecord {
        record_id: value_as_string(item, "RecordId"),
        name: value_as_string(item, "RR"),
        record_type: value_as_string(item, "Type"),
        line: line.clone(),
        line_id: if line_id.is_empty() { line } else { line_id },
        value: value_as_string(item, "Value"),
        ttl: value_as_u64(item, "TTL"),
        mx: value_as_u64(item, "Priority"),
        status,
        updated_on: value_as_string(item, "UpdateTime"),
        remark: value_as_string(item, "Remark"),
        default_ns: false,
    }
}

fn response_error(response: &Value) -> Option<String> {
    let code = value_as_string(response, "Code");
    if code.is_empty() {
        return None;
    }
    let message = value_as_string(response, "Message");
    if message.is_empty() {
        Some(code)
    } else {
        Some(format!("{code}: {message}"))
    }
}

fn request_id(response: &Value) -> Option<String> {
    response
        .get("RequestId")
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn first_non_empty(value: &Value, keys: &[&str]) -> String {
    keys.iter()
        .map(|key| value_as_string(value, key))
        .find(|item| !item.is_empty())
        .unwrap_or_default()
}

fn value_as_string(value: &Value, key: &str) -> String {
    match value.get(key) {
        Some(Value::String(item)) => item.to_string(),
        Some(Value::Number(item)) => item.to_string(),
        Some(Value::Bool(item)) => item.to_string(),
        _ => String::new(),
    }
}

fn value_as_u64(value: &Value, key: &str) -> u64 {
    value_as_u64_optional(value, key).unwrap_or_default()
}

fn value_as_u64_optional(value: &Value, key: &str) -> Option<u64> {
    match value.get(key) {
        Some(Value::Number(item)) => item.as_u64(),
        Some(Value::String(item)) => item.parse().ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn canonicalizes_rpc_parameters_with_rfc3986_encoding() {
        let parameters = vec![
            ("Timestamp".to_string(), "2016-02-23T12:46:24Z".to_string()),
            ("Action".to_string(), "DescribeDomains".to_string()),
            ("SearchMode".to_string(), "精确 + 匹配".to_string()),
        ];

        assert_eq!(
            canonicalized_query(&parameters),
            "Action=DescribeDomains&SearchMode=%E7%B2%BE%E7%A1%AE%20%2B%20%E5%8C%B9%E9%85%8D&Timestamp=2016-02-23T12%3A46%3A24Z"
        );
    }

    #[test]
    fn signs_with_hmac_sha1_and_base64() {
        assert_eq!(
            hmac_sha1_base64(b"key", "The quick brown fox jumps over the lazy dog").unwrap(),
            "3nybhbi3iqa8ino29wqQcBydtNk="
        );
    }

    #[test]
    fn signed_request_contains_required_rpc_fields() {
        let config = CloudConfig {
            provider: PROVIDER_ALIYUN.to_string(),
            secret_id: "test-id".to_string(),
            secret_key: "test-secret".to_string(),
            endpoint: "https://alidns.aliyuncs.com".to_string(),
            region: String::new(),
        };
        let signed = signed_parameters(
            &config,
            "DescribeDomains",
            RpcParameters::new(),
            "2016-02-23T12:46:24Z",
            "fixed-nonce",
        )
        .unwrap();

        assert_eq!(signed.get("Version").map(String::as_str), Some(VERSION));
        assert_eq!(
            signed.get("SignatureMethod").map(String::as_str),
            Some("HMAC-SHA1")
        );
        assert_eq!(
            signed.get("Signature").map(String::as_str),
            Some("IuoiDkTru8B/wCfY3bSgngIAAsA=")
        );
    }

    #[test]
    fn maps_domain_and_record_responses() {
        let domain = domain_summary(&json!({
            "DomainId": "1234",
            "DomainName": "example.com",
            "GroupName": "默认分组",
            "VersionName": "免费版",
            "RecordCount": 8,
            "Remark": "主域名",
            "UpdateTime": "2026-01-01T00:00Z"
        }));
        assert_eq!(domain.domain_id, "1234");
        assert_eq!(domain.name, "example.com");
        assert_eq!(domain.record_count, 8);

        let record = record_summary(&json!({
            "RecordId": "5678",
            "RR": "www",
            "Type": "A",
            "Line": "default",
            "LineId": "default",
            "Value": "203.0.113.1",
            "TTL": 600,
            "Priority": 10,
            "Status": "DISABLE",
            "Remark": "网站"
        }));
        assert_eq!(record.record_id, "5678");
        assert_eq!(record.name, "www");
        assert_eq!(record.status, "DISABLE");
        assert_eq!(record.mx, 10);
    }

    #[test]
    fn maps_default_line_and_mx_priority() {
        let input = RecordInput {
            provider: PROVIDER_ALIYUN.to_string(),
            domain: "example.com".to_string(),
            record_id: None,
            sub_domain: "mail".to_string(),
            record_type: "MX".to_string(),
            record_line: "默认".to_string(),
            value: "mail.example.com".to_string(),
            ttl: Some(600),
            mx: Some(10),
            status: DEFAULT_STATUS.to_string(),
            remark: String::new(),
        };
        let payload = record_parameters(&input);

        assert_eq!(payload.get("Line").map(String::as_str), Some("default"));
        assert_eq!(payload.get("Priority").map(String::as_str), Some("10"));
    }
}
