use hmac::{Hmac, Mac};
use reqwest::Method;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use time::{format_description, OffsetDateTime};

use crate::{
    ActionResult, CloudConfig, DnsRecord, DomainSummary, RecordInput, VerifyResult, DEFAULT_STATUS,
    PROVIDER_VOLCENGINE,
};

type HmacSha256 = Hmac<Sha256>;

const SERVICE: &str = "dns";
const VERSION: &str = "2018-08-01";
const DEFAULT_REGION: &str = "cn-beijing";
const DEFAULT_LINE: &str = "default";
const CONTENT_TYPE: &str = "application/json; charset=utf-8";

pub(crate) async fn verify(config: &CloudConfig) -> Result<VerifyResult, String> {
    let zones = list_zones(config).await?;
    let domains = zones.iter().map(zone_summary).collect::<Vec<_>>();

    Ok(VerifyResult {
        ok: true,
        message: "火山引擎 DNS 连接成功，AK/SK 和权限可用".to_string(),
        request_id: None,
        domain_count: Some(domains.len() as u64),
        domains,
    })
}

pub(crate) async fn list_records(
    config: &CloudConfig,
    domain: &str,
) -> Result<Vec<DnsRecord>, String> {
    let zid = zone_id(config, domain).await?;
    let mut records = Vec::new();
    let mut page = 1_i64;

    loop {
        let response = call_dns(
            config,
            "ListRecords",
            json!({
                "ZID": zid,
                "PageNumber": page,
                "PageSize": 500
            }),
        )
        .await?;
        let result = response_result(&response)?;
        if let Some(items) = result.get("Records").and_then(Value::as_array) {
            records.extend(items.iter().map(record_summary));
        }

        let total = value_as_u64(result, "TotalCount");
        if records.len() as u64 >= total || page >= 20 {
            break;
        }
        page += 1;
    }

    Ok(records)
}

pub(crate) async fn create_record(
    config: &CloudConfig,
    input: &RecordInput,
) -> Result<ActionResult, String> {
    let zid = zone_id(config, &input.domain).await?;
    let response = call_dns(config, "CreateRecord", record_payload(input, Some(zid))).await?;
    let result = response_result(&response)?;
    let record_id = value_as_string(result, "RecordID");

    if !record_id.is_empty() && !input.status.eq_ignore_ascii_case(DEFAULT_STATUS) {
        set_record_status(config, &record_id, false).await?;
    }

    Ok(ActionResult {
        ok: true,
        message: "解析记录已新增".to_string(),
        request_id: request_id(&response),
        record_id: if record_id.is_empty() {
            None
        } else {
            Some(record_id)
        },
    })
}

pub(crate) async fn update_record(
    config: &CloudConfig,
    input: &RecordInput,
    record_id: &str,
) -> Result<ActionResult, String> {
    let response = call_dns(
        config,
        "UpdateRecord",
        record_payload(input, None).with_field("RecordID", json!(record_id.trim())),
    )
    .await?;
    set_record_status(
        config,
        record_id,
        input.status.eq_ignore_ascii_case(DEFAULT_STATUS),
    )
    .await?;

    Ok(ActionResult {
        ok: true,
        message: "解析记录已修改".to_string(),
        request_id: request_id(&response),
        record_id: Some(record_id.to_string()),
    })
}

pub(crate) async fn delete_record(
    config: &CloudConfig,
    record_id: &str,
) -> Result<ActionResult, String> {
    let response = call_dns(
        config,
        "DeleteRecord",
        json!({
            "RecordID": record_id.trim()
        }),
    )
    .await?;

    Ok(ActionResult {
        ok: true,
        message: "解析记录已删除".to_string(),
        request_id: request_id(&response),
        record_id: Some(record_id.to_string()),
    })
}

async fn set_record_status(
    config: &CloudConfig,
    record_id: &str,
    enabled: bool,
) -> Result<(), String> {
    call_dns(
        config,
        "UpdateRecordStatus",
        json!({
            "RecordID": record_id.trim(),
            "Enable": enabled
        }),
    )
    .await?;
    Ok(())
}

async fn list_zones(config: &CloudConfig) -> Result<Vec<Value>, String> {
    let mut zones = Vec::new();
    let mut page = 1_i64;

    loop {
        let response = call_dns(
            config,
            "ListZones",
            json!({
                "PageNumber": page,
                "PageSize": 500
            }),
        )
        .await?;
        let result = response_result(&response)?;
        if let Some(items) = result.get("Zones").and_then(Value::as_array) {
            zones.extend(items.iter().cloned());
        }

        let total = value_as_u64(result, "Total");
        if zones.len() as u64 >= total || page >= 20 {
            break;
        }
        page += 1;
    }

    Ok(zones)
}

async fn zone_id(config: &CloudConfig, domain: &str) -> Result<i64, String> {
    list_zones(config)
        .await?
        .into_iter()
        .find(|item| value_as_string(item, "ZoneName").eq_ignore_ascii_case(domain))
        .and_then(|item| item.get("ZID").and_then(Value::as_i64))
        .ok_or_else(|| format!("火山引擎账号下没有找到域名 {domain}"))
}

async fn call_dns(config: &CloudConfig, action: &str, payload: Value) -> Result<Value, String> {
    let endpoint = normalize_endpoint(&config.endpoint);
    let host = endpoint_host(&endpoint)?;
    let region = effective_region(config);
    let body = serde_json::to_string(&payload).map_err(|err| format!("请求参数编码失败：{err}"))?;
    let date = request_date()?;
    let payload_hash = sha256_hex(body.as_bytes());
    let query = canonical_query(action);
    let authorization = authorization(config, &region, &host, &date, &payload_hash, &query)?;
    let url = format!("{}/?{query}", endpoint.trim_end_matches('/'));

    let response = reqwest::Client::new()
        .request(Method::POST, url)
        .header("Authorization", authorization)
        .header("Content-Type", CONTENT_TYPE)
        .header("Host", host)
        .header("X-Date", &date)
        .header("X-Content-Sha256", &payload_hash)
        .body(body)
        .send()
        .await
        .map_err(|err| format!("请求火山引擎失败：{err}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("读取火山引擎响应失败：{err}"))?;
    let value = serde_json::from_str::<Value>(&text)
        .map_err(|err| format!("火山引擎响应不是合法 JSON：{err}; 原始响应：{text}"))?;

    if let Some(error) = response_error(&value) {
        return Err(error);
    }
    if !status.is_success() {
        return Err(format!("火山引擎返回 HTTP {status}: {text}"));
    }

    Ok(value)
}

fn record_payload(input: &RecordInput, zid: Option<i64>) -> Value {
    let mut body = json!({
        "Host": input.sub_domain,
        "Line": api_line(&input.record_line),
        "Remark": input.remark,
        "TTL": input.ttl.unwrap_or(600),
        "Type": input.record_type,
        "Value": input.value
    });

    if let Some(zid) = zid {
        body = body.with_field("ZID", json!(zid));
    }
    if let Some(weight) = input.mx.filter(|value| *value > 0) {
        body = body.with_field("Weight", json!(weight));
    }

    body
}

fn zone_summary(item: &Value) -> DomainSummary {
    DomainSummary {
        domain_id: value_as_id_string(item, "ZID"),
        provider: PROVIDER_VOLCENGINE.to_string(),
        provider_label: "火山引擎 DNS".to_string(),
        name: value_as_string(item, "ZoneName"),
        status: value_as_string(item, "TradeCode"),
        dns_status: value_as_string(item, "DnsSecurity"),
        grade_title: value_as_string(item, "ProjectName"),
        record_count: value_as_u64(item, "RecordCount"),
        remark: value_as_string(item, "Remark"),
        updated_on: value_as_string(item, "UpdatedAt"),
    }
}

fn record_summary(item: &Value) -> DnsRecord {
    let enabled = item.get("Enable").and_then(Value::as_bool).unwrap_or(true);
    DnsRecord {
        record_id: value_as_id_string(item, "RecordID"),
        name: value_as_string(item, "Host"),
        record_type: value_as_string(item, "Type"),
        line: value_as_string(item, "Line"),
        line_id: value_as_id_string(item, "RecordSetID"),
        value: value_as_string(item, "Value"),
        ttl: value_as_u64(item, "TTL"),
        mx: value_as_u64(item, "Weight"),
        status: if enabled { "ENABLE" } else { "DISABLE" }.to_string(),
        updated_on: value_as_string(item, "UpdatedAt"),
        remark: value_as_string(item, "Remark"),
        default_ns: false,
    }
}

fn authorization(
    config: &CloudConfig,
    region: &str,
    host: &str,
    date: &str,
    payload_hash: &str,
    query: &str,
) -> Result<String, String> {
    let auth_date = date
        .get(0..8)
        .ok_or_else(|| "火山引擎请求时间格式错误".to_string())?;
    let signed_headers = "host;x-date;x-content-sha256;content-type";
    let canonical_headers = format!(
        "host:{host}\nx-date:{date}\nx-content-sha256:{payload_hash}\ncontent-type:{CONTENT_TYPE}\n"
    );
    let canonical_request = [
        "POST",
        "/",
        query,
        &canonical_headers,
        signed_headers,
        payload_hash,
    ]
    .join("\n");
    let credential_scope = format!("{auth_date}/{region}/{SERVICE}/request");
    let string_to_sign = [
        "HMAC-SHA256",
        date,
        &credential_scope,
        &sha256_hex(canonical_request.as_bytes()),
    ]
    .join("\n");
    let signed_key = signing_key(&config.secret_key, auth_date, region)?;
    let signature = hex::encode(hmac_sha256(&signed_key, &string_to_sign)?);

    Ok(format!(
        "HMAC-SHA256 Credential={}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}",
        config.secret_id.trim()
    ))
}

fn signing_key(secret_key: &str, date: &str, region: &str) -> Result<Vec<u8>, String> {
    let date_key = hmac_sha256(secret_key.as_bytes(), date)?;
    let region_key = hmac_sha256(&date_key, region)?;
    let service_key = hmac_sha256(&region_key, SERVICE)?;
    hmac_sha256(&service_key, "request")
}

fn hmac_sha256(key: &[u8], message: &str) -> Result<Vec<u8>, String> {
    let mut mac =
        HmacSha256::new_from_slice(key).map_err(|err| format!("HMAC 初始化失败：{err}"))?;
    mac.update(message.as_bytes());
    Ok(mac.finalize().into_bytes().to_vec())
}

fn sha256_hex(input: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input);
    hex::encode(hasher.finalize())
}

fn request_date() -> Result<String, String> {
    let format = format_description::parse("[year][month][day]T[hour][minute][second]Z")
        .map_err(|err| format!("时间格式初始化失败：{err}"))?;
    OffsetDateTime::now_utc()
        .format(&format)
        .map_err(|err| format!("时间格式化失败：{err}"))
}

fn canonical_query(action: &str) -> String {
    format!("Action={action}&Version={VERSION}")
}

fn effective_region(config: &CloudConfig) -> String {
    let region = config.region.trim();
    if region.is_empty() {
        DEFAULT_REGION.to_string()
    } else {
        region.to_string()
    }
}

fn api_line(line: &str) -> String {
    match line.trim() {
        "" | "默认" | "default" => DEFAULT_LINE.to_string(),
        item => item.to_string(),
    }
}

fn normalize_endpoint(endpoint: &str) -> String {
    let trimmed = endpoint.trim().trim_end_matches('/');
    let base = if trimmed.is_empty() {
        "https://dns.volcengineapi.com"
    } else {
        trimmed
    };

    if base.starts_with("http://") || base.starts_with("https://") {
        base.to_string()
    } else {
        format!("https://{base}")
    }
}

fn endpoint_host(endpoint: &str) -> Result<String, String> {
    let without_scheme = endpoint
        .strip_prefix("https://")
        .or_else(|| endpoint.strip_prefix("http://"))
        .ok_or_else(|| "Endpoint 必须以 http:// 或 https:// 开头".to_string())?;
    let host = without_scheme.split('/').next().unwrap_or_default().trim();
    if host.is_empty() {
        Err("Endpoint 缺少主机名".to_string())
    } else {
        Ok(host.to_string())
    }
}

fn response_result(response: &Value) -> Result<&Value, String> {
    response
        .get("Result")
        .ok_or_else(|| format!("火山引擎响应缺少 Result 字段：{response}"))
}

fn response_error(response: &Value) -> Option<String> {
    let error = response.get("ResponseMetadata")?.get("Error")?;
    let code = value_as_string(error, "Code");
    let message = value_as_string(error, "Message");
    if code.is_empty() && message.is_empty() {
        None
    } else if message.is_empty() {
        Some(code)
    } else {
        Some(format!("{code}: {message}"))
    }
}

fn request_id(response: &Value) -> Option<String> {
    response
        .get("ResponseMetadata")
        .and_then(|value| value.get("RequestId"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
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
    value.get(key).and_then(Value::as_u64).unwrap_or_default()
}

fn value_as_id_string(value: &Value, key: &str) -> String {
    value_as_string(value, key)
}

trait JsonObjectExt {
    fn with_field(self, key: &str, value: Value) -> Value;
}

impl JsonObjectExt for Value {
    fn with_field(mut self, key: &str, value: Value) -> Value {
        if let Value::Object(map) = &mut self {
            map.insert(key.to_string(), value);
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_default_line_for_api() {
        assert_eq!(api_line(""), "default");
        assert_eq!(api_line("默认"), "default");
        assert_eq!(api_line("default"), "default");
        assert_eq!(api_line("ChinaMobile"), "ChinaMobile");
    }

    #[test]
    fn uses_default_region_when_empty() {
        let config = CloudConfig {
            provider: PROVIDER_VOLCENGINE.to_string(),
            secret_id: "ak".to_string(),
            secret_key: "sk".to_string(),
            endpoint: String::new(),
            region: " ".to_string(),
        };
        assert_eq!(effective_region(&config), "cn-beijing");
    }

    #[test]
    fn maps_zone_to_domain_summary() {
        let summary = zone_summary(&json!({
            "ZID": 2636,
            "ZoneName": "example.com",
            "RecordCount": 12,
            "Remark": "main",
            "UpdatedAt": "2026-01-01T00:00:00Z"
        }));

        assert_eq!(summary.domain_id, "2636");
        assert_eq!(summary.provider, PROVIDER_VOLCENGINE);
        assert_eq!(summary.name, "example.com");
        assert_eq!(summary.record_count, 12);
        assert_eq!(summary.remark, "main");
    }

    #[test]
    fn maps_record_status_and_weight() {
        let record = record_summary(&json!({
            "RecordID": "317",
            "Host": "www",
            "Type": "A",
            "Line": "default",
            "Value": "203.0.113.1",
            "TTL": 600,
            "Weight": 10,
            "Enable": false
        }));

        assert_eq!(record.record_id, "317");
        assert_eq!(record.name, "www");
        assert_eq!(record.status, "DISABLE");
        assert_eq!(record.mx, 10);
    }
}
