import { useEffect, useMemo, useState } from "react";
import "./App.css";
import {
  CloseIcon,
  EyeIcon,
  EyeOffIcon,
  PlusIcon,
  RefreshIcon,
  SaveIcon,
  SettingsIcon,
  TrashIcon,
  UndoIcon,
} from "./icons";
import { providerMeta, providerOptions } from "./provider-options";
import {
  domainKey,
  draftsFromRecords,
  emptyRecordForm,
  hasRecordChanges,
  recordTitle,
  recordToForm,
  recordTypes,
} from "./record-utils";
import { invokeCommand, isTauriRuntime, toMessage } from "./tauri-runtime";
import type {
  DnsRecord,
  DomainSummary,
  ProviderKey,
  PublicConfig,
  RecordForm,
  VerifyResult,
} from "./types";

function App() {
  const [configs, setConfigs] = useState<PublicConfig[]>([]);
  const [configProvider, setConfigProvider] = useState<ProviderKey>("tencent");
  const [secretId, setSecretId] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [secretKeySaved, setSecretKeySaved] = useState(false);
  const [secretVisible, setSecretVisible] = useState(false);
  const [endpoint, setEndpoint] = useState(providerMeta("tencent").endpoint);
  const [region, setRegion] = useState("");
  const [activeDomainKey, setActiveDomainKey] = useState("");
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [recordDrafts, setRecordDrafts] = useState<Record<string, RecordForm>>({});
  const [recordForm, setRecordForm] = useState<RecordForm>(emptyRecordForm);
  const [notice, setNotice] = useState("未连接供应商");
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const desktopReady = useMemo(() => isTauriRuntime(), []);

  const activeDomain = useMemo(
    () => domains.find((item) => domainKey(item) === activeDomainKey),
    [activeDomainKey, domains],
  );
  const configFormProvider = providerMeta(configProvider);
  const activeProviderLabel = activeDomain?.providerLabel || `${configs.length} 个供应商`;
  const weightFieldLabel = activeDomain?.provider === "volcengine" ? "权重" : "MX";
  const recordLinePlaceholder =
    activeDomain?.provider === "cloudflare"
      ? "DNS only 或 Proxied"
      : activeDomain?.provider === "volcengine"
        ? "default"
        : "默认";
  const recordValueOptions = useMemo(
    () => Array.from(new Set(records.map((record) => record.value).filter(Boolean))).sort(),
    [records],
  );

  useEffect(() => {
    if (!desktopReady) {
      setNotice("浏览器预览模式");
      return;
    }

    invokeCommand<PublicConfig[]>("load_configs")
      .then((nextConfigs) => {
        setConfigs(nextConfigs);
        if (nextConfigs.length) {
          applyConfigToForm(nextConfigs[0].provider, nextConfigs);
          void syncAllProviders();
        } else {
          setConfigOpen(true);
        }
      })
      .catch((error) => setNotice(toMessage(error)));
  }, [desktopReady]);

  function configForProvider(provider: ProviderKey, source = configs) {
    return source.find((item) => item.provider === provider);
  }

  function applyConfigToForm(provider: ProviderKey, source = configs) {
    const existing = configForProvider(provider, source);
    const meta = providerMeta(provider);
    setConfigProvider(provider);
    setSecretId(existing?.secretId || "");
    setSecretKey("");
    setSecretKeySaved(Boolean(existing?.secretKeySaved));
    setSecretVisible(false);
    setEndpoint(existing?.endpoint || meta.endpoint);
    setRegion(existing?.region || "");
  }

  function mergeProviderDomains(provider: ProviderKey, nextDomains: DomainSummary[]) {
    setDomains((current) => [
      ...current.filter((item) => item.provider !== provider),
      ...nextDomains,
    ]);
  }

  async function persistConfig() {
    const config = await invokeCommand<PublicConfig>("save_config", {
      config: {
        provider: configProvider,
        secretId,
        secretKey,
        endpoint,
        region,
      },
    });
    setConfigs((current) => [
      ...current.filter((item) => item.provider !== config.provider),
      config,
    ]);
    applyConfigToForm(config.provider, [
      ...configs.filter((item) => item.provider !== config.provider),
      config,
    ]);
    return config;
  }

  async function verifyCurrentProvider() {
    setBusy("verify");
    try {
      const result = await invokeCommand<VerifyResult>("verify_config", {
        provider: configProvider,
      });
      setVerifyResult(result);
      mergeProviderDomains(configProvider, result.domains || []);
      const firstDomain = result.domains?.[0];
      if (!activeDomain && firstDomain) {
        await loadRecords(firstDomain);
      }
      setNotice(`${providerMeta(configProvider).shortLabel} 已同步 ${result.domains?.length || 0} 个域名`);
      setConfigOpen(false);
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function syncAllProviders() {
    setBusy("sync-all");
    try {
      const result = await invokeCommand<VerifyResult>("verify_all_configs");
      setVerifyResult(result);
      setDomains(result.domains || []);
      const activeStillExists = result.domains?.some((item) => domainKey(item) === activeDomainKey);
      const nextDomain = activeStillExists
        ? result.domains.find((item) => domainKey(item) === activeDomainKey)
        : result.domains?.[0];
      if (nextDomain) {
        await loadRecords(nextDomain);
      } else {
        setActiveDomainKey("");
        setRecords([]);
        setRecordDrafts({});
      }
      setNotice(result.message);
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function saveConfig(syncAfter = false) {
    setBusy(syncAfter ? "save-sync" : "save");
    try {
      await persistConfig();
      setNotice(`${providerMeta(configProvider).shortLabel} 配置已保存`);
      if (syncAfter) {
        await syncAllProviders();
        setConfigOpen(false);
      }
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function refreshCurrent() {
    if (configs.length) {
      await syncAllProviders();
      return;
    }
    setConfigOpen(true);
  }

  async function loadRecords(target = activeDomain) {
    if (!target) {
      setNotice("未选择域名");
      return;
    }

    setBusy("list");
    try {
      const nextRecords = await invokeCommand<DnsRecord[]>("list_records", {
        provider: target.provider,
        domain: target.name,
      });
      setActiveDomainKey(domainKey(target));
      setRecords(nextRecords);
      setRecordDrafts(draftsFromRecords(nextRecords));
      setRecordForm(emptyRecordForm);
      setNotice(`${target.providerLabel} · ${target.name}：${nextRecords.length} 条记录`);
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  function updateDraft(recordId: string, patch: Partial<RecordForm>) {
    setRecordDrafts((current) => ({
      ...current,
      [recordId]: {
        ...(current[recordId] || emptyRecordForm),
        ...patch,
      },
    }));
  }

  function resetDraft(record: DnsRecord) {
    setRecordDrafts((current) => ({
      ...current,
      [record.recordId]: recordToForm(record),
    }));
  }

  function recordPayload(form: RecordForm, recordId?: string) {
    if (!activeDomain) {
      throw new Error("未选择域名");
    }
    return {
      provider: activeDomain.provider,
      domain: activeDomain.name,
      recordId,
      subDomain: form.subDomain.trim(),
      recordType: form.recordType.trim(),
      recordLine: form.recordLine.trim(),
      value: form.value.trim(),
      ttl: Number(form.ttl || 600),
      mx: Number(form.mx || 0),
      status: form.status,
      remark: form.remark.trim(),
    };
  }

  async function saveInlineRecord(record: DnsRecord) {
    if (!activeDomain) return;
    const draft = recordDrafts[record.recordId];
    if (!draft || !hasRecordChanges(record, draft)) return;

    setBusy(`update-${record.recordId}`);
    try {
      await invokeCommand("update_record", {
        input: recordPayload(draft, record.recordId),
      });
      await loadRecords(activeDomain);
      setNotice(`${recordTitle(record, activeDomain.name)} 已保存`);
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function createRecord() {
    if (!activeDomain) {
      setNotice("未选择域名");
      return;
    }

    setBusy("create");
    try {
      await invokeCommand("create_record", {
        input: recordPayload(recordForm),
      });
      setAddOpen(false);
      setRecordForm(emptyRecordForm);
      await loadRecords(activeDomain);
      setNotice("解析记录已新增");
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function removeRecord(record: DnsRecord) {
    if (!activeDomain) return;
    const fullName = recordTitle(record, activeDomain.name);
    const confirmed = window.confirm(`确认删除 ${fullName} 这条解析记录吗？`);
    if (!confirmed) return;

    setBusy(`delete-${record.recordId}`);
    try {
      await invokeCommand("delete_record", {
        provider: activeDomain.provider,
        domain: activeDomain.name,
        recordId: record.recordId,
      });
      await loadRecords(activeDomain);
      setNotice(`${fullName} 已删除`);
    } catch (error) {
      setNotice(toMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">DB</div>
          <div>
            <h1>Domain Buddy</h1>
            <p>
              {activeProviderLabel}
              {activeDomain ? ` · ${activeDomain.name}` : " · 未选择域名"}
            </p>
          </div>
        </div>

        <div className="toolbar">
          <span className={verifyResult?.ok ? "connection on" : "connection"}>
            {notice}
          </span>
          <button
            className="icon-button"
            onClick={refreshCurrent}
            disabled={busy !== null || !desktopReady}
            title="同步全部供应商"
            aria-label="同步全部供应商"
          >
            <RefreshIcon />
          </button>
          <button
            className="primary-button"
            onClick={() => {
              setRecordForm(emptyRecordForm);
              setAddOpen(true);
            }}
            disabled={!activeDomain || busy !== null || !desktopReady}
          >
            <PlusIcon />
            添加
          </button>
          <button className="tool-button" onClick={() => setConfigOpen(true)} title="配置">
            <SettingsIcon />
            配置
          </button>
        </div>
      </header>

      <section className="domain-strip">
        {domains.map((item) => (
          <button
            className={domainKey(item) === activeDomainKey ? "domain-chip active" : "domain-chip"}
            key={domainKey(item)}
            onClick={() => loadRecords(item)}
            disabled={busy !== null || !desktopReady}
            title={item.remark || item.name}
          >
            <span className="provider-badge">{item.providerLabel}</span>
            <strong>{item.name}</strong>
            <span>{item.recordCount ? `${item.recordCount} 条记录` : item.status || "可用"}</span>
          </button>
        ))}
        {!domains.length && (
          <button className="domain-chip empty" onClick={() => setConfigOpen(true)}>
            <span className="provider-badge">{configs.length ? "All" : "Setup"}</span>
            <strong>{configs.length ? "同步全部供应商" : "添加供应商配置"}</strong>
            <span>{desktopReady ? `${configs.length} 个配置` : "Preview"}</span>
          </button>
        )}
      </section>

      <section className="records-panel">
        <div className="table-header">
          <div>
            <strong>{activeDomain?.name || "解析记录"}</strong>
            <span>{records.length} 条记录</span>
          </div>
          {activeDomain?.providerLabel && <em>{activeDomain.providerLabel}</em>}
        </div>

        <datalist id="record-value-options">
          {recordValueOptions.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>

        <div className="records-table">
          <table>
            <thead>
              <tr>
                <th>主机</th>
                <th>类型</th>
                <th>线路</th>
                <th>记录值</th>
                <th>TTL</th>
                <th>状态</th>
                <th>备注</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => {
                const draft = recordDrafts[record.recordId] || recordToForm(record);
                const changed = hasRecordChanges(record, draft);
                const locked = record.defaultNs || busy !== null || !desktopReady;

                return (
                  <tr key={record.recordId} className={record.defaultNs ? "system-row" : ""}>
                    <td>
                      <input
                        className="table-control host-control"
                        value={draft.subDomain}
                        onChange={(event) =>
                          updateDraft(record.recordId, { subDomain: event.currentTarget.value })
                        }
                        disabled={locked}
                        spellCheck={false}
                      />
                      <small>{record.recordId}</small>
                    </td>
                    <td>
                      <select
                        className="table-control"
                        value={draft.recordType}
                        onChange={(event) =>
                          updateDraft(record.recordId, { recordType: event.currentTarget.value })
                        }
                        disabled={locked}
                      >
                        {recordTypes.map((type) => (
                          <option key={type}>{type}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="table-control line-control"
                        value={draft.recordLine}
                        onChange={(event) =>
                          updateDraft(record.recordId, { recordLine: event.currentTarget.value })
                        }
                        disabled={locked}
                        spellCheck={false}
                      />
                    </td>
                    <td>
                      <input
                        className="table-control value-control"
                        value={draft.value}
                        list="record-value-options"
                        onChange={(event) =>
                          updateDraft(record.recordId, { value: event.currentTarget.value })
                        }
                        disabled={locked}
                        spellCheck={false}
                      />
                    </td>
                    <td>
                      <input
                        className="table-control ttl-control"
                        value={draft.ttl}
                        onChange={(event) =>
                          updateDraft(record.recordId, { ttl: event.currentTarget.value })
                        }
                        disabled={locked}
                        inputMode="numeric"
                      />
                    </td>
                    <td>
                      <select
                        className="table-control status-control"
                        value={draft.status}
                        onChange={(event) =>
                          updateDraft(record.recordId, {
                            status: event.currentTarget.value as RecordForm["status"],
                          })
                        }
                        disabled={locked || activeDomain?.provider === "cloudflare"}
                      >
                        <option value="ENABLE">启用</option>
                        <option value="DISABLE">暂停</option>
                      </select>
                    </td>
                    <td>
                      <input
                        className="table-control remark-control"
                        value={draft.remark}
                        onChange={(event) =>
                          updateDraft(record.recordId, { remark: event.currentTarget.value })
                        }
                        disabled={locked}
                        spellCheck={false}
                      />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="mini-button save"
                          onClick={() => saveInlineRecord(record)}
                          disabled={!changed || locked}
                          title="保存"
                          aria-label="保存"
                        >
                          <SaveIcon />
                        </button>
                        <button
                          className="mini-button"
                          onClick={() => resetDraft(record)}
                          disabled={!changed || locked}
                          title="还原"
                          aria-label="还原"
                        >
                          <UndoIcon />
                        </button>
                        <button
                          className="mini-button danger"
                          onClick={() => removeRecord(record)}
                          disabled={record.defaultNs || busy === `delete-${record.recordId}` || !desktopReady}
                          title={record.defaultNs ? "系统 NS 记录" : "删除"}
                          aria-label="删除"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!records.length && (
            <div className="empty-state">
              <strong>{activeDomain ? "暂无解析记录" : "未选择域名"}</strong>
              <button className="primary-button" onClick={() => setConfigOpen(true)}>
                <SettingsIcon />
                {configs.length ? "同步域名" : "配置"}
              </button>
            </div>
          )}
        </div>
      </section>

      {configOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="dialog" aria-modal="true" aria-label="供应商配置">
            <div className="modal-header">
              <div>
                <h2>供应商配置</h2>
                <p>
                  {configFormProvider.label} · {secretKeySaved ? "已保存凭证" : configFormProvider.status}
                </p>
              </div>
              <button className="icon-button" onClick={() => setConfigOpen(false)} aria-label="关闭">
                <CloseIcon />
              </button>
            </div>

            <div className="provider-tabs">
              {providerOptions.map((item) => {
                const saved = Boolean(configForProvider(item.value));
                const enabled = item.value !== "aliyun";
                return (
                  <button
                    key={item.value}
                    className={configProvider === item.value ? "provider-tab active" : "provider-tab"}
                    onClick={() => applyConfigToForm(item.value)}
                    disabled={!enabled}
                    title={enabled ? item.label : "尚未接入，当前版本不会收集或保存阿里云凭证"}
                  >
                    <strong>{item.shortLabel}</strong>
                    <span>{saved ? "已保存" : item.status}</span>
                  </button>
                );
              })}
            </div>

            <div className="modal-form">
              <label>
                {configFormProvider.secretIdLabel}
                <input
                  value={secretId}
                  onChange={(event) => setSecretId(event.currentTarget.value)}
                  placeholder={configFormProvider.secretIdPlaceholder}
                  spellCheck={false}
                />
              </label>
              <label>
                {configFormProvider.secretKeyLabel}
                <div className="secret-field">
                  <input
                    value={secretKey}
                    onChange={(event) => setSecretKey(event.currentTarget.value)}
                    placeholder={configFormProvider.secretKeyPlaceholder}
                    spellCheck={false}
                    type={secretVisible ? "text" : "password"}
                  />
                  <button
                    className="field-icon-button"
                    type="button"
                    onClick={() => setSecretVisible((visible) => !visible)}
                    title={secretVisible ? "隐藏凭证" : "显示凭证"}
                    aria-label={secretVisible ? "隐藏凭证" : "显示凭证"}
                  >
                    {secretVisible ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
              </label>
              <label>
                API Endpoint（官方固定地址）
                <input
                  value={endpoint}
                  placeholder={configFormProvider.endpoint}
                  readOnly
                  spellCheck={false}
                />
              </label>
              <label>
                {configFormProvider.regionLabel}
                <input
                  value={region}
                  onChange={(event) => setRegion(event.currentTarget.value)}
                  placeholder={configFormProvider.regionPlaceholder}
                  spellCheck={false}
                />
              </label>
            </div>

            <div className="modal-footer">
              <button className="secondary-button" onClick={() => saveConfig(false)} disabled={busy !== null || !desktopReady}>
                {busy === "save" ? "保存中" : "保存此供应商"}
              </button>
              <button className="secondary-button" onClick={verifyCurrentProvider} disabled={busy !== null || !desktopReady || !secretKeySaved}>
                {busy === "verify" ? "验证中" : "验证此供应商"}
              </button>
              <button className="primary-button" onClick={() => saveConfig(true)} disabled={busy !== null || !desktopReady}>
                {busy === "save-sync" || busy === "sync-all" ? "同步中" : "保存并同步全部"}
              </button>
            </div>
          </section>
        </div>
      )}

      {addOpen && activeDomain && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal compact-modal" role="dialog" aria-modal="true" aria-label="添加记录">
            <div className="modal-header">
              <div>
                <h2>添加记录</h2>
                <p>
                  {activeDomain.providerLabel} · {activeDomain.name}
                </p>
              </div>
              <button className="icon-button" onClick={() => setAddOpen(false)} aria-label="关闭">
                <CloseIcon />
              </button>
            </div>

            <div className="modal-form two-column">
              <label>
                主机
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
                  {recordTypes.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label>
                线路
                <input
                  value={recordForm.recordLine}
                  onChange={(event) =>
                    setRecordForm({ ...recordForm, recordLine: event.currentTarget.value })
                  }
                  placeholder={recordLinePlaceholder}
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
                {weightFieldLabel}
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
                  disabled={activeDomain.provider === "cloudflare"}
                >
                  <option value="ENABLE">启用</option>
                  <option value="DISABLE">暂停</option>
                </select>
              </label>
              <label className="span-2">
                记录值
                <input
                  value={recordForm.value}
                  list="record-value-options"
                  onChange={(event) =>
                    setRecordForm({ ...recordForm, value: event.currentTarget.value })
                  }
                  placeholder="IP、CNAME、TXT 内容或其它记录值"
                  spellCheck={false}
                />
              </label>
              <label className="span-2">
                备注
                <textarea
                  value={recordForm.remark}
                  onChange={(event) =>
                    setRecordForm({ ...recordForm, remark: event.currentTarget.value })
                  }
                  placeholder="内部备注，不影响 DNS 解析"
                  spellCheck={false}
                />
              </label>
            </div>

            <div className="modal-footer">
              <button className="secondary-button" onClick={() => setAddOpen(false)} disabled={busy !== null}>
                取消
              </button>
              <button className="primary-button" onClick={createRecord} disabled={busy !== null || !desktopReady}>
                {busy === "create" ? "添加中" : "添加记录"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
