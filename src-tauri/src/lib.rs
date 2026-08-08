mod credential_store;
mod pagination;
mod providers;

use hmac::{Hmac, Mac};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use time::{format_description, OffsetDateTime};

use pagination::{OffsetPager, PageNumberPager};

const PROVIDER_TENCENT: &str = "tencent";
const PROVIDER_CLOUDFLARE: &str = "cloudflare";
const PROVIDER_ALIYUN: &str = "aliyun";
pub(crate) const PROVIDER_VOLCENGINE: &str = "volcengine";
const DEFAULT_TENCENT_ENDPOINT: &str = "https://dnspod.tencentcloudapi.com";
const DEFAULT_CLOUDFLARE_ENDPOINT: &str = "https://api.cloudflare.com/client/v4";
const DEFAULT_ALIYUN_ENDPOINT: &str = "https://alidns.aliyuncs.com";
const DEFAULT_VOLCENGINE_ENDPOINT: &str = "https://dns.volcengineapi.com";
pub(crate) const DEFAULT_RECORD_LINE: &str = "默认";
pub(crate) const DEFAULT_STATUS: &str = "ENABLE";
const DNSPOD_SERVICE: &str = "dnspod";
const DNSPOD_VERSION: &str = "2021-03-23";
const DNSPOD_PAGE_SIZE: u64 = 3_000;
const CLOUDFLARE_ZONE_PAGE_SIZE: u64 = 50;
const CLOUDFLARE_RECORD_PAGE_SIZE: u64 = 5_000;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigStore {
    configs: Vec<CloudConfig>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudConfig {
    #[serde(default = "default_provider")]
    pub(crate) provider: String,
    #[serde(default)]
    pub(crate) secret_id: String,
    #[serde(default, skip_serializing)]
    pub(crate) secret_key: String,
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) region: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveConfig {
    #[serde(default = "default_provider")]
    provider: String,
    #[serde(default)]
    secret_id: String,
    secret_key: String,
    endpoint: String,
    #[serde(default)]
    region: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicConfig {
    provider: String,
    secret_id: String,
    secret_key_saved: bool,
    endpoint: String,
    region: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActionResult {
    pub(crate) ok: bool,
    pub(crate) message: String,
    pub(crate) request_id: Option<String>,
    pub(crate) record_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifyResult {
    pub(crate) ok: bool,
    pub(crate) message: String,
    pub(crate) request_id: Option<String>,
    pub(crate) domain_count: Option<u64>,
    pub(crate) domains: Vec<DomainSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DomainSummary {
    pub(crate) domain_id: String,
    pub(crate) provider: String,
    pub(crate) provider_label: String,
    pub(crate) name: String,
    pub(crate) status: String,
    pub(crate) dns_status: String,
    pub(crate) grade_title: String,
    pub(crate) record_count: u64,
    pub(crate) remark: String,
    pub(crate) updated_on: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DnsRecord {
    pub(crate) record_id: String,
    pub(crate) name: String,
    pub(crate) record_type: String,
    pub(crate) line: String,
    pub(crate) line_id: String,
    pub(crate) value: String,
    pub(crate) ttl: u64,
    pub(crate) mx: u64,
    pub(crate) status: String,
    pub(crate) updated_on: String,
    pub(crate) remark: String,
    pub(crate) default_ns: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecordInput {
    pub(crate) provider: String,
    pub(crate) domain: String,
    pub(crate) record_id: Option<String>,
    pub(crate) sub_domain: String,
    pub(crate) record_type: String,
    pub(crate) record_line: String,
    pub(crate) value: String,
    pub(crate) ttl: Option<u64>,
    pub(crate) mx: Option<u64>,
    pub(crate) status: String,
    #[serde(default)]
    pub(crate) remark: String,
}

fn default_provider() -> String {
    PROVIDER_TENCENT.to_string()
}

fn provider_key(provider: &str) -> String {
    let key = provider.trim().to_ascii_lowercase();
    if key.is_empty() {
        PROVIDER_TENCENT.to_string()
    } else {
        key
    }
}

fn provider_label(provider: &str) -> &'static str {
    match provider_key(provider).as_str() {
        PROVIDER_CLOUDFLARE => "Cloudflare",
        PROVIDER_ALIYUN => "阿里云 DNS",
        PROVIDER_VOLCENGINE => "火山引擎 DNS",
        _ => "腾讯云 DNSPod",
    }
}

fn default_endpoint_for_provider(provider: &str) -> &'static str {
    match provider_key(provider).as_str() {
        PROVIDER_CLOUDFLARE => DEFAULT_CLOUDFLARE_ENDPOINT,
        PROVIDER_ALIYUN => DEFAULT_ALIYUN_ENDPOINT,
        PROVIDER_VOLCENGINE => DEFAULT_VOLCENGINE_ENDPOINT,
        _ => DEFAULT_TENCENT_ENDPOINT,
    }
}

fn isolated_config_override() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    {
        std::env::var_os("DOMAIN_BUDDY_CONFIG_DIR")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    }
    #[cfg(not(debug_assertions))]
    {
        None
    }
}

fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = isolated_config_override() {
        if !dir.is_absolute() {
            return Err("DOMAIN_BUDDY_CONFIG_DIR 必须是绝对路径".to_string());
        }
        let metadata = fs::symlink_metadata(&dir)
            .map_err(|error| format!("隔离配置目录必须由 mktemp -d 预先创建：{error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("隔离配置路径必须是实际目录，不能是符号链接".to_string());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o077 != 0 {
                return Err("隔离配置目录权限过宽，请使用 mktemp -d 创建".to_string());
            }
        }
        return Ok(dir);
    }

    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("无法读取应用配置目录：{err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建应用配置目录：{err}"))?;
    Ok(dir)
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("tencent-cloud.json"))
}

fn credential_account(app: &tauri::AppHandle, provider: &str) -> Result<String, String> {
    let provider = provider_key(provider);
    if isolated_config_override().is_none() {
        return Ok(provider);
    }

    let dir = config_dir(app)?;
    let stable_dir = dir.canonicalize().unwrap_or(dir);
    let profile_hash = sha256_hex(&stable_dir.to_string_lossy());
    Ok(format!("isolated-{}:{provider}", &profile_hash[..16]))
}

fn normalize_endpoint(provider: &str, endpoint: &str) -> String {
    let trimmed = endpoint.trim().trim_end_matches('/');
    let base = if trimmed.is_empty() {
        default_endpoint_for_provider(provider)
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
    let url =
        reqwest::Url::parse(endpoint).map_err(|error| format!("Endpoint 不是合法 URL：{error}"))?;
    url.host_str()
        .map(ToString::to_string)
        .ok_or_else(|| "Endpoint 缺少主机名".to_string())
}

fn validate_provider_endpoint(provider: &str, endpoint: &str) -> Result<(), String> {
    let provider = provider_key(provider);
    let normalized = normalize_endpoint(&provider, endpoint);
    let actual = reqwest::Url::parse(&normalized)
        .map_err(|error| format!("Endpoint 不是合法 URL：{error}"))?;
    let expected = reqwest::Url::parse(default_endpoint_for_provider(&provider))
        .map_err(|error| format!("内置 Endpoint 配置错误：{error}"))?;

    let same_endpoint = actual.scheme() == "https"
        && actual.username().is_empty()
        && actual.password().is_none()
        && actual.host_str() == expected.host_str()
        && actual.port_or_known_default() == Some(443)
        && actual.path().trim_end_matches('/') == expected.path().trim_end_matches('/')
        && actual.query().is_none()
        && actual.fragment().is_none();

    if same_endpoint {
        Ok(())
    } else {
        Err(format!(
            "{} 仅允许使用官方 HTTPS Endpoint：{}",
            provider_label(&provider),
            default_endpoint_for_provider(&provider)
        ))
    }
}

pub(crate) fn provider_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| format!("无法初始化安全 HTTP 客户端：{error}"))
}

fn normalize_config(mut config: CloudConfig) -> CloudConfig {
    config.provider = provider_key(&config.provider);
    config.endpoint = normalize_endpoint(&config.provider, &config.endpoint);
    config.region = config.region.trim().to_string();
    config.secret_id = config.secret_id.trim().to_string();
    config.secret_key = config.secret_key.trim().to_string();
    config
}

fn read_saved_configs(app: &tauri::AppHandle) -> Result<Vec<CloudConfig>, String> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&path).map_err(|err| format!("无法读取配置文件：{err}"))?;
    let value = serde_json::from_str::<Value>(&content)
        .map_err(|err| format!("配置文件格式错误：{err}"))?;

    let mut configs = if value.get("configs").is_some() {
        let store = serde_json::from_value::<ConfigStore>(value)
            .map_err(|err| format!("配置文件格式错误：{err}"))?;
        store.configs
    } else {
        let config = serde_json::from_str::<CloudConfig>(&content)
            .map_err(|err| format!("配置文件格式错误：{err}"))?;
        vec![config]
    };

    configs = configs.into_iter().map(normalize_config).collect();
    let original_count = configs.len();
    configs.retain(|config| provider_key(&config.provider) != PROVIDER_ALIYUN);
    let mut metadata_changed = configs.len() != original_count;
    for config in &mut configs {
        if validate_provider_endpoint(&config.provider, &config.endpoint).is_err() {
            config.endpoint = default_endpoint_for_provider(&config.provider).to_string();
            metadata_changed = true;
        }
    }
    let has_legacy_plaintext = configs
        .iter()
        .any(|config| !config.secret_key.trim().is_empty());

    if has_legacy_plaintext {
        for config in &configs {
            if !config.secret_key.trim().is_empty() {
                let account = credential_account(app, &config.provider)?;
                credential_store::save(&account, &config.secret_key)?;
            }
        }
        metadata_changed = true;
    }

    if metadata_changed {
        write_saved_configs(app, configs.clone())?;
    }

    for config in &mut configs {
        let account = credential_account(app, &config.provider)?;
        config.secret_key = credential_store::load(&account)?.unwrap_or_default();
    }

    Ok(configs)
}

fn write_saved_configs(app: &tauri::AppHandle, configs: Vec<CloudConfig>) -> Result<(), String> {
    let mut deduped = Vec::<CloudConfig>::new();
    for config in configs.into_iter().map(normalize_config) {
        if let Some(existing) = deduped
            .iter_mut()
            .find(|item| provider_key(&item.provider) == provider_key(&config.provider))
        {
            *existing = config;
        } else {
            deduped.push(config);
        }
    }

    let path = config_path(app)?;
    let content = serde_json::to_string_pretty(&ConfigStore { configs: deduped })
        .map_err(|err| format!("配置序列化失败：{err}"))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("系统时间无效：{error}"))?
        .as_nanos();
    let temp_path = path.with_extension(format!("json.tmp.{}.{nonce}", std::process::id()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    let mut temp_file = options
        .open(&temp_path)
        .map_err(|err| format!("无法安全创建临时配置文件：{err}"))?;
    temp_file
        .write_all(content.as_bytes())
        .and_then(|_| temp_file.sync_all())
        .map_err(|err| format!("无法写入临时配置文件：{err}"))?;
    drop(temp_file);

    if let Err(rename_error) = fs::rename(&temp_path, &path) {
        if !cfg!(windows) || !path.exists() {
            return Err(format!("无法保存配置文件：{rename_error}"));
        }

        let backup_path = path.with_extension(format!("json.bak.{}", std::process::id()));
        fs::rename(&path, &backup_path).map_err(|error| format!("无法备份旧配置文件：{error}"))?;
        if let Err(error) = fs::rename(&temp_path, &path) {
            fs::rename(&backup_path, &path).map_err(|restore_error| {
                format!(
                    "配置替换失败：{error}；旧配置恢复也失败：{restore_error}；备份位于 {}",
                    backup_path.display()
                )
            })?;
            return Err(format!("配置替换失败，已恢复旧配置：{error}"));
        }
        let _ = fs::remove_file(backup_path);
    }

    Ok(())
}

fn read_required_config(app: &tauri::AppHandle, provider: &str) -> Result<CloudConfig, String> {
    let provider = provider_key(provider);
    let config = read_saved_configs(app)?
        .into_iter()
        .find(|item| provider_key(&item.provider) == provider)
        .ok_or_else(|| format!("请先保存 {} 配置", provider_label(&provider)))?;
    validate_config(&config)?;
    Ok(config)
}

fn validate_config(config: &CloudConfig) -> Result<(), String> {
    let provider = provider_key(&config.provider);
    validate_provider_endpoint(&provider, &config.endpoint)?;
    match provider.as_str() {
        PROVIDER_CLOUDFLARE => {
            if config.secret_key.trim().is_empty() {
                Err("Cloudflare API Token 不能为空".to_string())
            } else {
                Ok(())
            }
        }
        PROVIDER_ALIYUN => {
            if config.secret_id.trim().is_empty() || config.secret_key.trim().is_empty() {
                Err("阿里云 AccessKeyId 和 AccessKeySecret 不能为空".to_string())
            } else {
                Ok(())
            }
        }
        PROVIDER_VOLCENGINE => {
            if config.secret_id.trim().is_empty() || config.secret_key.trim().is_empty() {
                Err("火山引擎 AccessKeyId 和 SecretAccessKey 不能为空".to_string())
            } else {
                Ok(())
            }
        }
        _ => {
            if config.secret_id.trim().is_empty() || config.secret_key.trim().is_empty() {
                Err("腾讯云 SecretId 和 SecretKey 不能为空".to_string())
            } else {
                Ok(())
            }
        }
    }
}

fn to_public_config(config: CloudConfig) -> PublicConfig {
    PublicConfig {
        provider: provider_key(&config.provider),
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
    let format = format_description::parse_borrowed::<3>("[year]-[month]-[day]")
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

async fn call_dnspod_with_config(
    config: &CloudConfig,
    action: &str,
    payload: Value,
) -> Result<Value, String> {
    let endpoint = normalize_endpoint(&config.provider, &config.endpoint);
    let host = endpoint_host(&endpoint)?;
    let payload_text =
        serde_json::to_string(&payload).map_err(|err| format!("请求参数编码失败：{err}"))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| format!("系统时间早于 UNIX_EPOCH：{err}"))?
        .as_secs();
    let authorization = sign_request(config, &host, action, &payload_text, timestamp)?;

    let client = provider_http_client()?;
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

async fn call_cloudflare_with_config(
    config: &CloudConfig,
    method: Method,
    path: &str,
    payload: Option<Value>,
) -> Result<Value, String> {
    let endpoint = normalize_endpoint(&config.provider, &config.endpoint);
    let url = format!("{}{}", endpoint.trim_end_matches('/'), path);
    let client = provider_http_client()?;
    let mut request = client
        .request(method, url)
        .bearer_auth(config.secret_key.trim())
        .header("Content-Type", "application/json");

    if let Some(payload) = payload {
        request = request.json(&payload);
    }

    let response = request
        .send()
        .await
        .map_err(|err| format!("请求 Cloudflare 失败：{err}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| format!("读取 Cloudflare 响应失败：{err}"))?;

    let value = serde_json::from_str::<Value>(&text)
        .map_err(|err| format!("Cloudflare 响应不是合法 JSON：{err}; 原始响应：{text}"))?;
    if !status.is_success() {
        return Err(format!("Cloudflare 返回 HTTP {status}: {text}"));
    }
    if !value
        .get("success")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        let message = value
            .get("errors")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .map(|item| value_as_string(item, "message"))
                    .filter(|item| !item.is_empty())
                    .collect::<Vec<_>>()
                    .join("; ")
            })
            .filter(|item| !item.is_empty())
            .unwrap_or_else(|| value.to_string());
        return Err(format!("Cloudflare 请求失败：{message}"));
    }

    Ok(value)
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

fn request_id(response: &Value) -> Option<String> {
    response
        .get("RequestId")
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn response_record_id(response: &Value) -> Option<String> {
    response.get("RecordId").map(|value| match value {
        Value::String(item) => item.to_string(),
        Value::Number(item) => item.to_string(),
        _ => String::new(),
    })
}

fn domain_summaries(response: &Value) -> Vec<DomainSummary> {
    response
        .get("DomainList")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| DomainSummary {
                    domain_id: value_as_id_string(item, "DomainId"),
                    provider: PROVIDER_TENCENT.to_string(),
                    provider_label: provider_label(PROVIDER_TENCENT).to_string(),
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

async fn dnspod_domains(
    config: &CloudConfig,
) -> Result<(Vec<DomainSummary>, Option<String>), String> {
    let mut pager = OffsetPager::default();
    let mut domains = Vec::new();
    let mut total = None;
    let mut latest_request_id = None;

    loop {
        let response = call_dnspod_with_config(
            config,
            "DescribeDomainList",
            json!({
                "Type": "ALL",
                "Offset": pager.offset(),
                "Limit": DNSPOD_PAGE_SIZE
            }),
        )
        .await?;

        latest_request_id = request_id(&response).or(latest_request_id);
        total = response
            .get("DomainCountInfo")
            .and_then(|value| value.get("AllTotal"))
            .and_then(Value::as_u64)
            .or(total);
        let page = domain_summaries(&response);
        let has_next = pager.advance(page.len(), total, "DNSPod 域名")?;
        domains.extend(page);
        if !has_next {
            break;
        }
    }

    Ok((domains, latest_request_id))
}

fn dnspod_record_summaries(response: &Value) -> Vec<DnsRecord> {
    response
        .get("RecordList")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| DnsRecord {
                    record_id: value_as_id_string(item, "RecordId"),
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
        .unwrap_or_default()
}

async fn dnspod_records(config: &CloudConfig, domain: &str) -> Result<Vec<DnsRecord>, String> {
    let mut pager = OffsetPager::default();
    let mut records = Vec::new();
    let mut total = None;

    loop {
        let response = call_dnspod_with_config(
            config,
            "DescribeRecordList",
            json!({
                "Domain": domain,
                "Offset": pager.offset(),
                "Limit": DNSPOD_PAGE_SIZE,
                "ErrorOnEmpty": "no"
            }),
        )
        .await?;

        total = response
            .get("RecordCountInfo")
            .and_then(|value| value.get("TotalCount"))
            .and_then(Value::as_u64)
            .or(total);
        let page = dnspod_record_summaries(&response);
        let has_next = pager.advance(page.len(), total, "DNSPod 解析记录")?;
        records.extend(page);
        if !has_next {
            break;
        }
    }

    Ok(records)
}

fn cloudflare_domain_summaries(zones: &[Value]) -> Vec<DomainSummary> {
    zones
        .iter()
        .map(|item| DomainSummary {
            domain_id: value_as_id_string(item, "id"),
            provider: PROVIDER_CLOUDFLARE.to_string(),
            provider_label: provider_label(PROVIDER_CLOUDFLARE).to_string(),
            name: value_as_string(item, "name"),
            status: value_as_string(item, "status"),
            dns_status: String::new(),
            grade_title: item
                .get("plan")
                .map(|plan| value_as_string(plan, "name"))
                .unwrap_or_default(),
            record_count: 0,
            remark: value_as_string(item, "type"),
            updated_on: value_as_string(item, "modified_on"),
        })
        .collect()
}

async fn cloudflare_zones(config: &CloudConfig) -> Result<Vec<Value>, String> {
    let mut zones = Vec::new();
    let mut pager = PageNumberPager::default();
    let mut total_pages = None;
    let mut total_items = None;

    loop {
        let response = call_cloudflare_with_config(
            config,
            Method::GET,
            &format!(
                "/zones?per_page={CLOUDFLARE_ZONE_PAGE_SIZE}&page={}",
                pager.page()
            ),
            None,
        )
        .await?;
        let result_info = response.get("result_info");
        total_pages = result_info
            .and_then(|value| value.get("total_pages"))
            .and_then(Value::as_u64)
            .or(total_pages);
        total_items = result_info
            .and_then(|value| value.get("total_count"))
            .and_then(Value::as_u64)
            .or(total_items);
        let page = response
            .get("result")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let has_next = pager.advance(page.len(), total_pages, total_items, "Cloudflare 域名")?;
        zones.extend(page);
        if !has_next {
            break;
        }
    }

    Ok(zones)
}

fn cloudflare_record_summaries(response: &Value, domain: &str) -> Vec<DnsRecord> {
    response
        .get("result")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    let proxied = item
                        .get("proxied")
                        .and_then(Value::as_bool)
                        .unwrap_or_default();
                    DnsRecord {
                        record_id: value_as_id_string(item, "id"),
                        name: relative_record_name(&value_as_string(item, "name"), domain),
                        record_type: value_as_string(item, "type"),
                        line: if proxied { "Proxied" } else { "DNS only" }.to_string(),
                        line_id: String::new(),
                        value: value_as_string(item, "content"),
                        ttl: value_as_u64(item, "ttl"),
                        mx: value_as_u64(item, "priority"),
                        status: DEFAULT_STATUS.to_string(),
                        updated_on: value_as_string(item, "modified_on"),
                        remark: value_as_string(item, "comment"),
                        default_ns: false,
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

async fn cloudflare_records(
    config: &CloudConfig,
    zone_id: &str,
    domain: &str,
) -> Result<Vec<DnsRecord>, String> {
    let mut pager = PageNumberPager::default();
    let mut records = Vec::new();
    let mut total_pages = None;
    let mut total_items = None;

    loop {
        let response = call_cloudflare_with_config(
            config,
            Method::GET,
            &format!(
                "/zones/{zone_id}/dns_records?per_page={CLOUDFLARE_RECORD_PAGE_SIZE}&page={}",
                pager.page()
            ),
            None,
        )
        .await?;
        let result_info = response.get("result_info");
        total_pages = result_info
            .and_then(|value| value.get("total_pages"))
            .and_then(Value::as_u64)
            .or(total_pages);
        total_items = result_info
            .and_then(|value| value.get("total_count"))
            .and_then(Value::as_u64)
            .or(total_items);
        let page = cloudflare_record_summaries(&response, domain);
        let has_next =
            pager.advance(page.len(), total_pages, total_items, "Cloudflare 解析记录")?;
        records.extend(page);
        if !has_next {
            break;
        }
    }

    Ok(records)
}

async fn cloudflare_zone_id(config: &CloudConfig, domain: &str) -> Result<String, String> {
    cloudflare_zones(config)
        .await?
        .into_iter()
        .find(|item| value_as_string(item, "name").eq_ignore_ascii_case(domain))
        .map(|item| value_as_id_string(&item, "id"))
        .filter(|item| !item.is_empty())
        .ok_or_else(|| format!("Cloudflare 账号下没有找到域名 {domain}"))
}

fn relative_record_name(name: &str, domain: &str) -> String {
    if name.eq_ignore_ascii_case(domain) {
        "@".to_string()
    } else {
        name.strip_suffix(&format!(".{domain}"))
            .unwrap_or(name)
            .to_string()
    }
}

fn absolute_record_name(domain: &str, sub_domain: &str) -> String {
    let sub_domain = sub_domain.trim();
    if sub_domain.is_empty() || sub_domain == "@" {
        domain.to_string()
    } else if sub_domain.ends_with(domain) {
        sub_domain.to_string()
    } else {
        format!("{sub_domain}.{domain}")
    }
}

fn normalize_record_input(input: RecordInput) -> Result<RecordInput, String> {
    if input.domain.trim().is_empty() {
        return Err("域名不能为空".to_string());
    }

    let provider = provider_key(&input.provider);
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
        provider,
        domain: input.domain.trim().to_string(),
        record_id: input.record_id,
        sub_domain,
        record_type,
        record_line,
        value: input.value.trim().to_string(),
        ttl: Some(input.ttl.unwrap_or(600)),
        mx: Some(input.mx.unwrap_or(0)),
        status,
        remark: input.remark.trim().to_string(),
    })
}

fn parse_dnspod_record_id(record_id: &str) -> Result<i64, String> {
    record_id
        .trim()
        .parse::<i64>()
        .map_err(|_| "RecordId 不正确".to_string())
        .and_then(|id| {
            if id <= 0 {
                Err("RecordId 不正确".to_string())
            } else {
                Ok(id)
            }
        })
}

async fn modify_dnspod_record_remark(
    config: &CloudConfig,
    domain: &str,
    record_id: i64,
    remark: &str,
) -> Result<Option<String>, String> {
    let response = call_dnspod_with_config(
        config,
        "ModifyRecordRemark",
        json!({
            "Domain": domain,
            "RecordId": record_id,
            "Remark": remark
        }),
    )
    .await?;
    Ok(request_id(&response))
}

fn cloudflare_record_payload(input: &RecordInput) -> Value {
    let mut body = Map::new();
    body.insert("type".to_string(), json!(input.record_type));
    body.insert(
        "name".to_string(),
        json!(absolute_record_name(&input.domain, &input.sub_domain)),
    );
    body.insert("content".to_string(), json!(input.value));
    body.insert("ttl".to_string(), json!(input.ttl.unwrap_or(600)));
    body.insert("comment".to_string(), json!(input.remark));

    if input.record_type == "MX" {
        body.insert("priority".to_string(), json!(input.mx.unwrap_or(0)));
    }

    if matches!(input.record_type.as_str(), "A" | "AAAA" | "CNAME") {
        let proxied = input.record_line.eq_ignore_ascii_case("proxied")
            || input.record_line.eq_ignore_ascii_case("代理");
        body.insert("proxied".to_string(), json!(proxied));
    }

    Value::Object(body)
}

async fn verify_with_config(config: &CloudConfig) -> Result<VerifyResult, String> {
    match provider_key(&config.provider).as_str() {
        PROVIDER_CLOUDFLARE => {
            let zones = cloudflare_zones(config).await?;
            let domains = cloudflare_domain_summaries(&zones);
            Ok(VerifyResult {
                ok: true,
                message: "Cloudflare 连接成功，API Token 可用".to_string(),
                request_id: None,
                domain_count: Some(domains.len() as u64),
                domains,
            })
        }
        PROVIDER_VOLCENGINE => providers::volcengine::verify(config).await,
        PROVIDER_ALIYUN => Err("阿里云配置已保存，但 DNS API 接入还在预留中".to_string()),
        _ => {
            let (domains, request_id) = dnspod_domains(config).await?;

            Ok(VerifyResult {
                ok: true,
                message: "腾讯云 DNSPod 连接成功，凭证和权限可用".to_string(),
                request_id,
                domain_count: Some(domains.len() as u64),
                domains,
            })
        }
    }
}

#[tauri::command]
fn load_configs(app: tauri::AppHandle) -> Result<Vec<PublicConfig>, String> {
    read_saved_configs(&app).map(|configs| configs.into_iter().map(to_public_config).collect())
}

#[tauri::command]
fn load_config(app: tauri::AppHandle) -> Result<Option<PublicConfig>, String> {
    read_saved_configs(&app).map(|configs| configs.into_iter().next().map(to_public_config))
}

#[tauri::command]
fn save_config(app: tauri::AppHandle, config: SaveConfig) -> Result<PublicConfig, String> {
    let provider = provider_key(&config.provider);
    if provider == PROVIDER_ALIYUN {
        return Err("阿里云 DNS 尚未接入，当前版本不会保存其访问凭证".to_string());
    }

    let mut configs = read_saved_configs(&app)?;
    let existing = configs
        .iter()
        .find(|item| provider_key(&item.provider) == provider)
        .cloned();
    let previous_secret = existing
        .as_ref()
        .map(|item| item.secret_key.clone())
        .unwrap_or_default();
    let secret_id = config.secret_id.trim().to_string();
    let submitted_secret = config.secret_key.trim().to_string();
    let secret_key = if submitted_secret.is_empty() {
        existing
            .as_ref()
            .map(|item| item.secret_key.clone())
            .unwrap_or_default()
    } else {
        submitted_secret.clone()
    };

    let stored = CloudConfig {
        provider: provider.clone(),
        secret_id,
        secret_key,
        endpoint: normalize_endpoint(&provider, &config.endpoint),
        region: config.region.trim().to_string(),
    };
    endpoint_host(&stored.endpoint)?;
    validate_config(&stored)?;

    let changed_account = if !submitted_secret.is_empty() {
        let account = credential_account(&app, &provider)?;
        credential_store::save(&account, &submitted_secret)?;
        Some(account)
    } else {
        None
    };

    configs.retain(|item| provider_key(&item.provider) != provider);
    configs.push(stored.clone());
    if let Err(metadata_error) = write_saved_configs(&app, configs) {
        if let Some(account) = changed_account {
            let rollback_result = if previous_secret.is_empty() {
                credential_store::delete(&account)
            } else {
                credential_store::save(&account, &previous_secret)
            };
            return match rollback_result {
                Ok(()) => Err(format!("{metadata_error}；系统凭证库已恢复原值")),
                Err(rollback_error) => Err(format!(
                    "{metadata_error}；系统凭证库回滚失败：{rollback_error}"
                )),
            };
        }
        return Err(metadata_error);
    }

    Ok(to_public_config(stored))
}

#[tauri::command]
async fn verify_config(app: tauri::AppHandle, provider: String) -> Result<VerifyResult, String> {
    let config = read_required_config(&app, &provider)?;
    verify_with_config(&config).await
}

#[tauri::command]
async fn verify_all_configs(app: tauri::AppHandle) -> Result<VerifyResult, String> {
    let configs = read_saved_configs(&app)?;
    if configs.is_empty() {
        return Err("请先保存至少一个供应商配置".to_string());
    }

    let mut domains = Vec::new();
    let mut failures = Vec::new();
    for config in configs {
        if let Err(error) = validate_config(&config) {
            failures.push(format!("{}: {error}", provider_label(&config.provider)));
            continue;
        }
        match verify_with_config(&config).await {
            Ok(result) => domains.extend(result.domains),
            Err(error) => failures.push(format!("{}: {error}", provider_label(&config.provider))),
        }
    }

    if domains.is_empty() && !failures.is_empty() {
        return Err(failures.join("；"));
    }

    let message = if failures.is_empty() {
        format!("已同步 {} 个域名", domains.len())
    } else {
        format!(
            "已同步 {} 个域名；{} 个供应商未同步",
            domains.len(),
            failures.len()
        )
    };

    Ok(VerifyResult {
        ok: true,
        message,
        request_id: None,
        domain_count: Some(domains.len() as u64),
        domains,
    })
}

#[tauri::command]
async fn list_records(
    app: tauri::AppHandle,
    provider: String,
    domain: String,
) -> Result<Vec<DnsRecord>, String> {
    let provider = provider_key(&provider);
    let domain = domain.trim().to_string();
    if domain.is_empty() {
        return Err("请先选择要管理的主域名".to_string());
    }

    let config = read_required_config(&app, &provider)?;
    match provider.as_str() {
        PROVIDER_CLOUDFLARE => {
            let zone_id = cloudflare_zone_id(&config, &domain).await?;
            cloudflare_records(&config, &zone_id, &domain).await
        }
        PROVIDER_VOLCENGINE => providers::volcengine::list_records(&config, &domain).await,
        PROVIDER_ALIYUN => Err("阿里云 DNS 记录管理还在预留中".to_string()),
        _ => dnspod_records(&config, &domain).await,
    }
}

#[tauri::command]
async fn create_record(app: tauri::AppHandle, input: RecordInput) -> Result<ActionResult, String> {
    let input = normalize_record_input(input)?;
    let config = read_required_config(&app, &input.provider)?;
    match provider_key(&input.provider).as_str() {
        PROVIDER_CLOUDFLARE => {
            let zone_id = cloudflare_zone_id(&config, &input.domain).await?;
            let response = call_cloudflare_with_config(
                &config,
                Method::POST,
                &format!("/zones/{zone_id}/dns_records"),
                Some(cloudflare_record_payload(&input)),
            )
            .await?;
            let record_id = response
                .get("result")
                .map(|item| value_as_id_string(item, "id"))
                .filter(|item| !item.is_empty());
            Ok(ActionResult {
                ok: true,
                message: "解析记录已新增".to_string(),
                request_id: None,
                record_id,
            })
        }
        PROVIDER_VOLCENGINE => providers::volcengine::create_record(&config, &input).await,
        PROVIDER_ALIYUN => Err("阿里云 DNS 记录管理还在预留中".to_string()),
        _ => {
            let domain = input.domain.clone();
            let response = call_dnspod_with_config(
                &config,
                "CreateRecord",
                json!({
                    "Domain": domain,
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
            let record_id = response_record_id(&response);

            if let Some(record_id_text) = record_id.as_ref() {
                let record_id_number = parse_dnspod_record_id(record_id_text)?;
                if !input.remark.is_empty() {
                    modify_dnspod_record_remark(&config, &domain, record_id_number, &input.remark)
                        .await?;
                }
            }

            Ok(ActionResult {
                ok: true,
                message: "解析记录已新增".to_string(),
                request_id: request_id(&response),
                record_id,
            })
        }
    }
}

#[tauri::command]
async fn update_record(app: tauri::AppHandle, input: RecordInput) -> Result<ActionResult, String> {
    let input = normalize_record_input(input)?;
    let record_id = input
        .record_id
        .clone()
        .ok_or_else(|| "缺少 RecordId".to_string())?;
    let config = read_required_config(&app, &input.provider)?;

    match provider_key(&input.provider).as_str() {
        PROVIDER_CLOUDFLARE => {
            let zone_id = cloudflare_zone_id(&config, &input.domain).await?;
            call_cloudflare_with_config(
                &config,
                Method::PUT,
                &format!("/zones/{zone_id}/dns_records/{record_id}"),
                Some(cloudflare_record_payload(&input)),
            )
            .await?;
            Ok(ActionResult {
                ok: true,
                message: "解析记录已修改".to_string(),
                request_id: None,
                record_id: Some(record_id),
            })
        }
        PROVIDER_VOLCENGINE => {
            providers::volcengine::update_record(&config, &input, &record_id).await
        }
        PROVIDER_ALIYUN => Err("阿里云 DNS 记录管理还在预留中".to_string()),
        _ => {
            let record_id_number = parse_dnspod_record_id(&record_id)?;
            let domain = input.domain.clone();
            let response = call_dnspod_with_config(
                &config,
                "ModifyRecord",
                json!({
                    "Domain": domain,
                    "RecordId": record_id_number,
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
            modify_dnspod_record_remark(&config, &domain, record_id_number, &input.remark).await?;

            Ok(ActionResult {
                ok: true,
                message: "解析记录已修改".to_string(),
                request_id: request_id(&response),
                record_id: response_record_id(&response).or(Some(record_id)),
            })
        }
    }
}

#[tauri::command]
async fn delete_record(
    app: tauri::AppHandle,
    provider: String,
    domain: String,
    record_id: String,
) -> Result<ActionResult, String> {
    if domain.trim().is_empty() {
        return Err("域名不能为空".to_string());
    }
    if record_id.trim().is_empty() {
        return Err("RecordId 不正确".to_string());
    }

    let provider = provider_key(&provider);
    let config = read_required_config(&app, &provider)?;
    match provider.as_str() {
        PROVIDER_CLOUDFLARE => {
            let zone_id = cloudflare_zone_id(&config, domain.trim()).await?;
            call_cloudflare_with_config(
                &config,
                Method::DELETE,
                &format!("/zones/{zone_id}/dns_records/{}", record_id.trim()),
                None,
            )
            .await?;
            Ok(ActionResult {
                ok: true,
                message: "解析记录已删除".to_string(),
                request_id: None,
                record_id: Some(record_id),
            })
        }
        PROVIDER_VOLCENGINE => {
            providers::volcengine::delete_record(&config, domain.trim(), &record_id).await
        }
        PROVIDER_ALIYUN => Err("阿里云 DNS 记录管理还在预留中".to_string()),
        _ => {
            let record_id_number = parse_dnspod_record_id(&record_id)?;
            let response = call_dnspod_with_config(
                &config,
                "DeleteRecord",
                json!({
                    "Domain": domain.trim(),
                    "RecordId": record_id_number
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
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_config,
            load_configs,
            save_config,
            verify_config,
            verify_all_configs,
            list_records,
            create_record,
            update_record,
            delete_record
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod config_security_tests {
    use super::*;

    fn config(provider: &str, endpoint: &str) -> CloudConfig {
        CloudConfig {
            provider: provider.to_string(),
            secret_id: "public-id".to_string(),
            secret_key: "top-secret".to_string(),
            endpoint: endpoint.to_string(),
            region: String::new(),
        }
    }

    #[test]
    fn accepts_only_the_official_https_endpoint() {
        assert!(
            validate_provider_endpoint(PROVIDER_CLOUDFLARE, DEFAULT_CLOUDFLARE_ENDPOINT).is_ok()
        );
        assert!(validate_provider_endpoint(
            PROVIDER_CLOUDFLARE,
            "http://api.cloudflare.com/client/v4"
        )
        .is_err());
        assert!(
            validate_provider_endpoint(PROVIDER_CLOUDFLARE, "https://example.com/client/v4")
                .is_err()
        );
    }

    #[test]
    fn serialized_metadata_never_contains_the_secret() {
        let content = serde_json::to_string(&ConfigStore {
            configs: vec![config(PROVIDER_TENCENT, DEFAULT_TENCENT_ENDPOINT)],
        })
        .unwrap();

        assert!(!content.contains("top-secret"));
        assert!(!content.contains("secretKey"));
        assert!(content.contains("public-id"));
    }
}
