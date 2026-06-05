use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use time::{format_description, OffsetDateTime};

const DEFAULT_ENDPOINT: &str = "https://dnspod.tencentcloudapi.com";
const DEFAULT_RECORD_LINE: &str = "默认";
const DEFAULT_STATUS: &str = "ENABLE";
const DNSPOD_SERVICE: &str = "dnspod";
const DNSPOD_VERSION: &str = "2021-03-23";

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudConfig {
    secret_id: String,
    secret_key: String,
    endpoint: String,
    region: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveConfig {
    secret_id: String,
    secret_key: String,
    endpoint: String,
    region: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicConfig {
    secret_id: String,
    secret_key_saved: bool,
    endpoint: String,
    region: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActionResult {
    ok: bool,
    message: String,
    request_id: Option<String>,
    record_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VerifyResult {
    ok: bool,
    message: String,
    request_id: Option<String>,
    domain_count: Option<u64>,
    domains: Vec<DomainSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DomainSummary {
    domain_id: i64,
    name: String,
    status: String,
    dns_status: String,
    grade_title: String,
    record_count: u64,
    remark: String,
    updated_on: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DnsRecord {
    record_id: i64,
    name: String,
    record_type: String,
    line: String,
    line_id: String,
    value: String,
    ttl: u64,
    mx: u64,
    status: String,
    updated_on: String,
    remark: String,
    default_ns: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecordInput {
    domain: String,
    record_id: Option<i64>,
    sub_domain: String,
    record_type: String,
    record_line: String,
    value: String,
    ttl: Option<u64>,
    mx: Option<u64>,
    status: String,
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("无法读取应用配置目录：{err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建应用配置目录：{err}"))?;
    Ok(dir.join("tencent-cloud.json"))
}

fn normalize_endpoint(endpoint: &str) -> String {
    let trimmed = endpoint.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        DEFAULT_ENDPOINT.to_string()
    } else if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
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

fn read_saved_config(app: &tauri::AppHandle) -> Result<Option<CloudConfig>, String> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path).map_err(|err| format!("无法读取配置文件：{err}"))?;
    let config = serde_json::from_str::<CloudConfig>(&content)
        .map_err(|err| format!("配置文件格式错误：{err}"))?;
    Ok(Some(config))
}

fn read_required_config(app: &tauri::AppHandle) -> Result<CloudConfig, String> {
    let config = read_saved_config(app)?.ok_or_else(|| "请先保存腾讯云配置".to_string())?;
    if config.secret_id.trim().is_empty() || config.secret_key.trim().is_empty() {
        Err("SecretId 和 SecretKey 不能为空".to_string())
    } else {
        Ok(config)
    }
}

fn to_public_config(config: CloudConfig) -> PublicConfig {
    PublicConfig {
        secret_id: config.secret_id,
        secret_key_saved: !config.secret_key.trim().is_empty(),
        endpoint: config.endpoint,
        region: config.region,
    }
}

fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

fn hmac_sha256(key: &[u8], message: &str) -> Result<Vec<u8>, String> {
    let mut mac =
        HmacSha256::new_from_slice(key).map_err(|err| format!("HMAC 初始化失败：{err}"))?;
    mac.update(message.as_bytes());
    Ok(mac.finalize().into_bytes().to_vec())
}

fn utc_date(timestamp: u64) -> Result<String, String> {
    let format = format_description::parse("[year]-[month]-[day]")
        .map_err(|err| format!("日期格式初始化失败：{err}"))?;
    OffsetDateTime::from_unix_timestamp(timestamp as i64)
        .map_err(|err| format!("系统时间无效：{err}"))?
        .format(&format)
        .map_err(|err| format!("日期格式化失败：{err}"))
}

fn sign_request(
    config: &CloudConfig,
    host: &str,
    _action: &str,
    payload: &str,
    timestamp: u64,
) -> Result<String, String> {
    let date = utc_date(timestamp)?;
    let content_type = "application/json; charset=utf-8";
    let canonical_headers = format!("content-type:{content_type}\nhost:{host}\n");
    let signed_headers = "content-type;host";
    let hashed_request_payload = sha256_hex(payload);
    let canonical_request =
        format!("POST\n/\n\n{canonical_headers}\n{signed_headers}\n{hashed_request_payload}");
    let credential_scope = format!("{date}/{DNSPOD_SERVICE}/tc3_request");
    let string_to_sign = format!(
        "TC3-HMAC-SHA256\n{timestamp}\n{credential_scope}\n{}",
        sha256_hex(&canonical_request)
    );

    let secret_date = hmac_sha256(format!("TC3{}", config.secret_key).as_bytes(), &date)?;
    let secret_service = hmac_sha256(&secret_date, DNSPOD_SERVICE)?;
    let secret_signing = hmac_sha256(&secret_service, "tc3_request")?;
    let signature = hex::encode(hmac_sha256(&secret_signing, &string_to_sign)?);

    Ok(format!(
        "TC3-HMAC-SHA256 Credential={}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}",
        config.secret_id
    ))
}

async fn call_dnspod(
    app: &tauri::AppHandle,
    action: &str,
    payload: Value,
) -> Result<Value, String> {
    let config = read_required_config(app)?;
    let endpoint = normalize_endpoint(&config.endpoint);
    let host = endpoint_host(&endpoint)?;
    let payload_text =
        serde_json::to_string(&payload).map_err(|err| format!("请求参数编码失败：{err}"))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("系统时间早于 UNIX_EPOCH：{err}"))?
        .as_secs();
    let authorization = sign_request(&config, &host, action, &payload_text, timestamp)?;

    let client = reqwest::Client::new();
    let mut request = client
        .post(endpoint)
        .header("Authorization", authorization)
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Host", host)
        .header("X-TC-Action", action)
        .header("X-TC-Version", DNSPOD_VERSION)
        .header("X-TC-Timestamp", timestamp.to_string())
        .body(payload_text);

    if !config.region.trim().is_empty() {
        request = request.header("X-TC-Region", config.region.trim());
    }

    let response = request
        .send()
        .await
        .map_err(|err| format!("请求腾讯云失败：{err}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("读取腾讯云响应失败：{err}"))?;

    if !status.is_success() {
        return Err(format!("腾讯云返回 HTTP {status}: {text}"));
    }

    let value = serde_json::from_str::<Value>(&text)
        .map_err(|err| format!("腾讯云响应不是合法 JSON：{err}; 原始响应：{text}"))?;
    let response = value
        .get("Response")
        .cloned()
        .ok_or_else(|| format!("腾讯云响应缺少 Response 字段：{value}"))?;

    if let Some(error) = response.get("Error") {
        let code = value_as_string(error, "Code");
        let message = value_as_string(error, "Message");
        return Err(format!("{code}: {message}"));
    }

    Ok(response)
}

fn value_as_string(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn value_as_i64(value: &Value, key: &str) -> i64 {
    value.get(key).and_then(Value::as_i64).unwrap_or_default()
}

fn value_as_u64(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or_default()
}

fn request_id(response: &Value) -> Option<String> {
    response
        .get("RequestId")
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn response_record_id(response: &Value) -> Option<i64> {
    response.get("RecordId").and_then(Value::as_i64)
}

fn domain_summaries(response: &Value) -> Vec<DomainSummary> {
    response
        .get("DomainList")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| DomainSummary {
                    domain_id: value_as_i64(item, "DomainId"),
                    name: value_as_string(item, "Name"),
                    status: value_as_string(item, "Status"),
                    dns_status: value_as_string(item, "DNSStatus"),
                    grade_title: value_as_string(item, "GradeTitle"),
                    record_count: value_as_u64(item, "RecordCount"),
                    remark: value_as_string(item, "Remark"),
                    updated_on: value_as_string(item, "UpdatedOn"),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn normalize_record_input(input: RecordInput) -> Result<RecordInput, String> {
    if input.domain.trim().is_empty() {
        return Err("域名不能为空".to_string());
    }

    let sub_domain = if input.sub_domain.trim().is_empty() {
        "@".to_string()
    } else {
        input.sub_domain.trim().to_string()
    };
    let record_type = if input.record_type.trim().is_empty() {
        "A".to_string()
    } else {
        input.record_type.trim().to_ascii_uppercase()
    };
    let record_line = if input.record_line.trim().is_empty() {
        DEFAULT_RECORD_LINE.to_string()
    } else {
        input.record_line.trim().to_string()
    };
    let status = if input.status.trim().is_empty() {
        DEFAULT_STATUS.to_string()
    } else {
        input.status.trim().to_ascii_uppercase()
    };

    if input.value.trim().is_empty() {
        return Err("记录值不能为空".to_string());
    }

    Ok(RecordInput {
        domain: input.domain.trim().to_string(),
        record_id: input.record_id,
        sub_domain,
        record_type,
        record_line,
        value: input.value.trim().to_string(),
        ttl: Some(input.ttl.unwrap_or(600)),
        mx: Some(input.mx.unwrap_or(0)),
        status,
    })
}

#[tauri::command]
fn load_config(app: tauri::AppHandle) -> Result<Option<PublicConfig>, String> {
    read_saved_config(&app).map(|config| config.map(to_public_config))
}

#[tauri::command]
fn save_config(app: tauri::AppHandle, config: SaveConfig) -> Result<PublicConfig, String> {
    let existing = read_saved_config(&app)?;
    let secret_id = config.secret_id.trim().to_string();
    let secret_key = if config.secret_key.trim().is_empty() {
        existing
            .as_ref()
            .map(|item| item.secret_key.clone())
            .unwrap_or_default()
    } else {
        config.secret_key.trim().to_string()
    };

    if secret_id.is_empty() {
        return Err("SecretId 不能为空".to_string());
    }
    if secret_key.is_empty() {
        return Err("SecretKey 不能为空；如已保存，可留空保留原值".to_string());
    }

    let stored = CloudConfig {
        secret_id,
        secret_key,
        endpoint: normalize_endpoint(&config.endpoint),
        region: config.region.trim().to_string(),
    };
    endpoint_host(&stored.endpoint)?;

    let path = config_path(&app)?;
    let content =
        serde_json::to_string_pretty(&stored).map_err(|err| format!("配置序列化失败：{err}"))?;
    fs::write(&path, content).map_err(|err| format!("无法写入配置文件：{err}"))?;

    Ok(to_public_config(stored))
}

#[tauri::command]
async fn verify_config(app: tauri::AppHandle) -> Result<VerifyResult, String> {
    let response = call_dnspod(
        &app,
        "DescribeDomainList",
        json!({
            "Type": "ALL",
            "Offset": 0,
            "Limit": 3000
        }),
    )
    .await?;

    let domain_count = response
        .get("DomainCountInfo")
        .and_then(|value| value.get("AllTotal"))
        .and_then(Value::as_u64);

    Ok(VerifyResult {
        ok: true,
        message: "腾讯云 DNSPod 连接成功，凭证和权限可用".to_string(),
        request_id: request_id(&response),
        domain_count,
        domains: domain_summaries(&response),
    })
}

#[tauri::command]
async fn list_records(app: tauri::AppHandle, domain: String) -> Result<Vec<DnsRecord>, String> {
    let domain = domain.trim().to_string();
    if domain.is_empty() {
        return Err("请先输入要管理的主域名".to_string());
    }

    let response = call_dnspod(
        &app,
        "DescribeRecordList",
        json!({
            "Domain": domain,
            "Offset": 0,
            "Limit": 3000,
            "ErrorOnEmpty": "no"
        }),
    )
    .await?;

    let records = response
        .get("RecordList")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| DnsRecord {
                    record_id: value_as_i64(item, "RecordId"),
                    name: value_as_string(item, "Name"),
                    record_type: value_as_string(item, "Type"),
                    line: value_as_string(item, "Line"),
                    line_id: value_as_string(item, "LineId"),
                    value: value_as_string(item, "Value"),
                    ttl: value_as_u64(item, "TTL"),
                    mx: value_as_u64(item, "MX"),
                    status: value_as_string(item, "Status"),
                    updated_on: value_as_string(item, "UpdatedOn"),
                    remark: value_as_string(item, "Remark"),
                    default_ns: item
                        .get("DefaultNS")
                        .and_then(Value::as_bool)
                        .unwrap_or_default(),
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(records)
}

#[tauri::command]
async fn create_record(app: tauri::AppHandle, input: RecordInput) -> Result<ActionResult, String> {
    let input = normalize_record_input(input)?;
    let response = call_dnspod(
        &app,
        "CreateRecord",
        json!({
            "Domain": input.domain,
            "SubDomain": input.sub_domain,
            "RecordType": input.record_type,
            "RecordLine": input.record_line,
            "Value": input.value,
            "TTL": input.ttl.unwrap_or(600),
            "MX": input.mx.unwrap_or(0),
            "Status": input.status
        }),
    )
    .await?;

    Ok(ActionResult {
        ok: true,
        message: "解析记录已新增".to_string(),
        request_id: request_id(&response),
        record_id: response_record_id(&response),
    })
}

#[tauri::command]
async fn update_record(app: tauri::AppHandle, input: RecordInput) -> Result<ActionResult, String> {
    let input = normalize_record_input(input)?;
    let record_id = input.record_id.ok_or_else(|| "缺少 RecordId".to_string())?;
    let response = call_dnspod(
        &app,
        "ModifyRecord",
        json!({
            "Domain": input.domain,
            "RecordId": record_id,
            "SubDomain": input.sub_domain,
            "RecordType": input.record_type,
            "RecordLine": input.record_line,
            "Value": input.value,
            "TTL": input.ttl.unwrap_or(600),
            "MX": input.mx.unwrap_or(0),
            "Status": input.status
        }),
    )
    .await?;

    Ok(ActionResult {
        ok: true,
        message: "解析记录已修改".to_string(),
        request_id: request_id(&response),
        record_id: response_record_id(&response).or(Some(record_id)),
    })
}

#[tauri::command]
async fn delete_record(
    app: tauri::AppHandle,
    domain: String,
    record_id: i64,
) -> Result<ActionResult, String> {
    if domain.trim().is_empty() {
        return Err("域名不能为空".to_string());
    }
    if record_id <= 0 {
        return Err("RecordId 不正确".to_string());
    }

    let response = call_dnspod(
        &app,
        "DeleteRecord",
        json!({
            "Domain": domain.trim(),
            "RecordId": record_id
        }),
    )
    .await?;

    Ok(ActionResult {
        ok: true,
        message: "解析记录已删除".to_string(),
        request_id: request_id(&response),
        record_id: Some(record_id),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            verify_config,
            list_records,
            create_record,
            update_record,
            delete_record
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
