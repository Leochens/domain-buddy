import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type PublicConfig = {
  secretId: string;
  secretKeySaved: boolean;
  endpoint: string;
  region: string;
};

type VerifyResult = {
  ok: boolean;
  message: string;
  requestId?: string;
  domainCount?: number;
  domains: DomainSummary[];
};

type DomainSummary = {
  domainId: number;
  name: string;
  status: string;
  dnsStatus: string;
  gradeTitle: string;
  recordCount: number;
  remark: string;
  updatedOn: string;
};

type DnsRecord = {
  recordId: number;
  name: string;
  recordType: string;
  line: string;
  lineId: string;
  value: string;
  ttl: number;
  mx: number;
  status: string;
  updatedOn: string;
  remark: string;
  defaultNs: boolean;
};

type RecordForm = {
  recordId?: number;
  subDomain: string;
  recordType: string;
  recordLine: string;
  value: string;
  ttl: string;
  mx: string;
  status: "ENABLE" | "DISABLE";
};

const defaultEndpoint = "https://dnspod.tencentcloudapi.com";
const emptyRecordForm: RecordForm = {
  subDomain: "www",
  recordType: "A",
  recordLine: "默认",
  value: "",
  ttl: "600",
  mx: "0",
  status: "ENABLE",
};

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>) {
  if (!isTauriRuntime()) {
    throw new Error("当前是浏览器预览模式，请在 Tauri 桌面应用中保存配置和调用腾讯云 API。");
  }
  return invoke<T>(command, args);
}

function App() {
  const [secretId, setSecretId] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [secretKeySaved, setSecretKeySaved] = useState(false);
  const [endpoint, setEndpoint] = useState(defaultEndpoint);
  const [region, setRegion] = useState("");
  const [domain, setDomain] = useState("");
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [selectedRecordId, setSelectedRecordId] = useState<number | undefined>();
  const [recordForm, setRecordForm] = useState<RecordForm>(emptyRecordForm);
  const [notice, setNotice] = useState("请先保存腾讯云 SecretId 和 SecretKey。");
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const desktopReady = useMemo(() => isTauriRuntime(), []);

  const selectedRecord = useMemo(
    () => records.find((record) => record.recordId === selectedRecordId),
    [records, selectedRecordId],
  );

  useEffect(() => {
    if (!desktopReady) {
      setNotice("浏览器预览模式：界面可查看，保存配置和腾讯云 API 调用请使用 Tauri 桌面应用。");
      return;
    }

    invokeCommand<PublicConfig | null>("load_config")
      .then((config) => {
        if (!config) return;
        setSecretId(config.secretId);
        setSecretKeySaved(config.secretKeySaved);
        setEndpoint(config.endpoint || defaultEndpoint);
        setRegion(config.region || "");
        setNotice("已加载本地配置，可以直接验证连接。");
      })
      .catch((error) => setNotice(toMessage(error)));
  }, [desktopReady]);

  async function saveConfig() {
    setBusy("save");
    setVerifyResult(null);
    try {
      const config = await invokeCommand<PublicConfig>("save_config", {
        config: {
          secretId,
          secretKey,
          endpoint,
          region,
        },
      });
      setSecretKey("");
      setSecretKeySaved(config.secretKeySaved);
      setEndpoint(config.endpoint);
      setRegion(config.region);
      setDomains([]);
      setRecords([]);
      setNotice("配置已保存到本机应用配置目录。");
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function verifyConfig() {
    setBusy("verify");
    try {
      const result = await invokeCommand<VerifyResult>("verify_config");
      setVerifyResult(result);
      setDomains(result.domains || []);
      if (!domain.trim() && result.domains?.length) {
        setDomain(result.domains[0].name);
      }
      setNotice(`${result.message}，已同步 ${result.domains?.length || 0} 个域名。`);
    } catch (error) {
      setVerifyResult(null);
      setDomains([]);
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function loadRecords(nextDomain = domain) {
    if (!nextDomain.trim()) {
      setNotice("请输入要管理的主域名，例如 example.com。");
      return;
    }

    setBusy("list");
    try {
      const nextRecords = await invokeCommand<DnsRecord[]>("list_records", {
        domain: nextDomain.trim(),
      });
      setDomain(nextDomain.trim());
      setRecords(nextRecords);
      setSelectedRecordId(undefined);
      setRecordForm(emptyRecordForm);
      setNotice(`已加载 ${nextRecords.length} 条解析记录。`);
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  function editRecord(record: DnsRecord) {
    setSelectedRecordId(record.recordId);
    setRecordForm({
      recordId: record.recordId,
      subDomain: record.name || "@",
      recordType: record.recordType || "A",
      recordLine: record.line || "默认",
      value: record.value,
      ttl: String(record.ttl || 600),
      mx: String(record.mx || 0),
      status: record.status === "DISABLE" ? "DISABLE" : "ENABLE",
    });
    setNotice(`正在编辑 ${record.name}.${domain}。`);
  }

  function resetForm() {
    setSelectedRecordId(undefined);
    setRecordForm(emptyRecordForm);
  }

  function recordPayload() {
    return {
      domain: domain.trim(),
      recordId: recordForm.recordId,
      subDomain: recordForm.subDomain.trim(),
      recordType: recordForm.recordType.trim(),
      recordLine: recordForm.recordLine.trim(),
      value: recordForm.value.trim(),
      ttl: Number(recordForm.ttl || 600),
      mx: Number(recordForm.mx || 0),
      status: recordForm.status,
    };
  }

  async function submitRecord() {
    if (!domain.trim()) {
      setNotice("请先输入主域名。");
      return;
    }

    const isEditing = Boolean(selectedRecordId);
    setBusy(isEditing ? "update" : "create");
    try {
      await invokeCommand(isEditing ? "update_record" : "create_record", {
        input: recordPayload(),
      });
      await loadRecords();
      resetForm();
      setNotice(isEditing ? "解析记录已修改。" : "解析记录已新增。");
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function removeRecord(record: DnsRecord) {
    const fullName = record.name === "@" ? domain : `${record.name}.${domain}`;
    const confirmed = window.confirm(`确认删除 ${fullName} 这条解析记录吗？`);
    if (!confirmed) return;

    setBusy(`delete-${record.recordId}`);
    try {
      await invokeCommand("delete_record", {
        domain: domain.trim(),
        recordId: record.recordId,
      });
      await loadRecords();
      setNotice(`${fullName} 已删除。`);
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="app-shell">
      <aside className="config-panel">
        <div className="brand">
          <div className="brand-mark">DB</div>
          <div>
            <h1>Domain Buddy</h1>
            <p>本地管理腾讯云 DNSPod 解析记录</p>
          </div>
        </div>

        <section className="panel-section">
          <div className="section-heading">
            <h2>腾讯云配置</h2>
            <span>{secretKeySaved ? "已保存 Key" : "未保存 Key"}</span>
          </div>

          <label>
            SecretId
            <input
              value={secretId}
              onChange={(event) => setSecretId(event.currentTarget.value)}
              placeholder="AKID..."
              spellCheck={false}
            />
          </label>

          <label>
            SecretKey
            <input
              value={secretKey}
              onChange={(event) => setSecretKey(event.currentTarget.value)}
              placeholder={secretKeySaved ? "留空则保留已保存 SecretKey" : "创建时展示一次的 SecretKey"}
              spellCheck={false}
              type="password"
            />
          </label>

          <label>
            API Endpoint
            <input
              value={endpoint}
              onChange={(event) => setEndpoint(event.currentTarget.value)}
              placeholder={defaultEndpoint}
              spellCheck={false}
            />
          </label>

          <label>
            Region（可选）
            <input
              value={region}
              onChange={(event) => setRegion(event.currentTarget.value)}
              placeholder="通常可留空，例如 ap-guangzhou"
              spellCheck={false}
            />
          </label>

          <div className="button-row">
            <button onClick={saveConfig} disabled={busy !== null || !desktopReady}>
              {busy === "save" ? "保存中" : "保存配置"}
            </button>
            <button className="secondary" onClick={verifyConfig} disabled={busy !== null || !desktopReady}>
              {busy === "verify" ? "验证中" : "验证连接"}
            </button>
          </div>
        </section>

        <section className="panel-section notice-section">
          <div className={verifyResult?.ok ? "status ok" : "status"}>
            <strong>{notice}</strong>
            {verifyResult?.requestId && <span>RequestId: {verifyResult.requestId}</span>}
            {typeof verifyResult?.domainCount === "number" && (
              <span>账号域名数量：{verifyResult.domainCount}</span>
            )}
            {verifyResult && <span>已显示域名：{domains.length}</span>}
          </div>
        </section>
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <h2>解析记录</h2>
            <p>先验证连接并选择主域名，加载后即可新增、修改或删除子域名记录。</p>
          </div>
          <div className="domain-search">
            <input
              value={domain}
              onChange={(event) => setDomain(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") loadRecords();
              }}
              placeholder="example.com"
              spellCheck={false}
            />
            <button onClick={() => loadRecords()} disabled={busy !== null || !desktopReady}>
              {busy === "list" ? "加载中" : "加载记录"}
            </button>
          </div>
        </header>

        {domains.length > 0 && (
          <section className="domain-list-panel">
            <div className="domain-list-header">
              <h2>账号域名</h2>
              <span>{domains.length} 个域名，点击后加载解析记录</span>
            </div>
            <div className="domain-list">
              {domains.map((item) => (
                <button
                  className={item.name === domain ? "domain-card active" : "domain-card"}
                  key={item.domainId || item.name}
                  onClick={() => loadRecords(item.name)}
                  disabled={busy !== null || !desktopReady}
                  title={item.remark || item.name}
                >
                  <strong>{item.name}</strong>
                  <span>
                    {item.status === "ENABLE" ? "启用" : "暂停"}
                    {item.dnsStatus ? ` · DNS ${item.dnsStatus}` : ""}
                    {` · ${item.recordCount} 条记录`}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="content-grid">
          <section className="records-panel">
            <div className="table-header">
              <span>{records.length ? `${records.length} 条记录` : "暂无记录"}</span>
              {selectedRecord && <em>正在编辑 RecordId {selectedRecord.recordId}</em>}
            </div>

            <div className="records-table">
              <table>
                <thead>
                  <tr>
                    <th>主机记录</th>
                    <th>类型</th>
                    <th>线路</th>
                    <th>记录值</th>
                    <th>TTL</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.recordId} className={record.defaultNs ? "system-row" : ""}>
                      <td>
                        <strong>{record.name}</strong>
                        <small>{record.recordId}</small>
                      </td>
                      <td>{record.recordType}</td>
                      <td>{record.line}</td>
                      <td className="value-cell">{record.value}</td>
                      <td>{record.ttl}</td>
                      <td>
                        <span className={record.status === "ENABLE" ? "pill on" : "pill"}>
                          {record.status === "ENABLE" ? "启用" : "暂停"}
                        </span>
                      </td>
                      <td className="actions">
                        <button className="ghost" onClick={() => editRecord(record)}>
                          编辑
                        </button>
                        <button
                          className="danger"
                          onClick={() => removeRecord(record)}
                          disabled={record.defaultNs || busy === `delete-${record.recordId}` || !desktopReady}
                          title={record.defaultNs ? "系统默认 NS 记录不建议删除" : "删除记录"}
                        >
                          {busy === `delete-${record.recordId}` ? "删除中" : "删除"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!records.length && (
                <div className="empty-state">
                  <strong>输入域名后加载记录</strong>
                  <span>这里会列出 DNSPod 返回的全部解析记录，包括控制台隐藏的默认 NS 记录。</span>
                </div>
              )}
            </div>
          </section>

          <section className="editor-panel">
            <div className="section-heading">
              <h2>{selectedRecordId ? "修改记录" : "新增记录"}</h2>
              {selectedRecordId && <button className="ghost" onClick={resetForm}>取消编辑</button>}
            </div>

            <div className="form-grid">
              <label>
                主机记录
                <input
                  value={recordForm.subDomain}
                  onChange={(event) =>
                    setRecordForm({ ...recordForm, subDomain: event.currentTarget.value })
                  }
                  placeholder="@ 或 www"
                  spellCheck={false}
                />
              </label>

              <label>
                类型
                <select
                  value={recordForm.recordType}
                  onChange={(event) =>
                    setRecordForm({ ...recordForm, recordType: event.currentTarget.value })
                  }
                >
                  <option>A</option>
                  <option>AAAA</option>
                  <option>CNAME</option>
                  <option>TXT</option>
                  <option>MX</option>
                  <option>NS</option>
                  <option>CAA</option>
                  <option>SRV</option>
                </select>
              </label>

              <label>
                线路
                <input
                  value={recordForm.recordLine}
                  onChange={(event) =>
                    setRecordForm({ ...recordForm, recordLine: event.currentTarget.value })
                  }
                  placeholder="默认"
                />
              </label>

              <label>
                TTL
                <input
                  value={recordForm.ttl}
                  onChange={(event) =>
                    setRecordForm({ ...recordForm, ttl: event.currentTarget.value })
                  }
                  inputMode="numeric"
                />
              </label>

              <label>
                MX
                <input
                  value={recordForm.mx}
                  onChange={(event) =>
                    setRecordForm({ ...recordForm, mx: event.currentTarget.value })
                  }
                  inputMode="numeric"
                />
              </label>

              <label>
                状态
                <select
                  value={recordForm.status}
                  onChange={(event) =>
                    setRecordForm({
                      ...recordForm,
                      status: event.currentTarget.value as RecordForm["status"],
                    })
                  }
                >
                  <option value="ENABLE">启用</option>
                  <option value="DISABLE">暂停</option>
                </select>
              </label>

              <label className="span-2">
                记录值
                <textarea
                  value={recordForm.value}
                  onChange={(event) =>
                    setRecordForm({ ...recordForm, value: event.currentTarget.value })
                  }
                  placeholder="IP、CNAME、TXT 内容或其它记录值"
                  spellCheck={false}
                />
              </label>
            </div>

            <div className="button-row align-end">
              <button className="secondary" onClick={resetForm} disabled={busy !== null}>
                清空
              </button>
              <button onClick={submitRecord} disabled={busy !== null || !desktopReady}>
                {busy === "create" || busy === "update"
                  ? "提交中"
                  : selectedRecordId
                    ? "保存修改"
                    : "新增记录"}
              </button>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

export default App;
