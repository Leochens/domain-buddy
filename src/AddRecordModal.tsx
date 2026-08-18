import { CloseIcon } from "./icons";
import { recordTypeDefinitions } from "./record-metadata";
import { RecordTypeGuide } from "./RecordTypeGuide";
import type { DomainSummary, RecordForm } from "./types";

type AddRecordModalProps = {
  domain: DomainSummary;
  form: RecordForm;
  busy: boolean;
  creating: boolean;
  desktopReady: boolean;
  onChange: (patch: Partial<RecordForm>) => void;
  onClose: () => void;
  onCreate: () => void;
};

export function AddRecordModal({
  domain,
  form,
  busy,
  creating,
  desktopReady,
  onChange,
  onClose,
  onCreate,
}: AddRecordModalProps) {
  const weightFieldLabel = domain.provider === "volcengine" ? "权重" : "MX 优先级";
  const recordLinePlaceholder =
    domain.provider === "cloudflare"
      ? "DNS only 或 Proxied"
      : domain.provider === "volcengine"
        ? "default"
        : "默认";

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal compact-modal" role="dialog" aria-modal="true" aria-label="添加记录">
        <div className="modal-header">
          <div>
            <h2>添加记录</h2>
            <p>
              {domain.providerLabel} · {domain.name}
            </p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <CloseIcon />
          </button>
        </div>

        <div className="modal-form two-column">
          <label>
            主机
            <input
              value={form.subDomain}
              onChange={(event) => onChange({ subDomain: event.currentTarget.value })}
              placeholder="@ 或 www"
              spellCheck={false}
            />
            <small className="field-help">@ 表示根域名；www 会生成 www.{domain.name}。</small>
          </label>
          <label>
            类型
            <select
              value={form.recordType}
              onChange={(event) => onChange({ recordType: event.currentTarget.value })}
            >
              {recordTypeDefinitions.map((definition) => (
                <option key={definition.value} value={definition.value}>
                  {definition.value} — {definition.label}
                </option>
              ))}
            </select>
          </label>

          <RecordTypeGuide type={form.recordType} />

          <label>
            线路
            <input
              value={form.recordLine}
              onChange={(event) => onChange({ recordLine: event.currentTarget.value })}
              placeholder={recordLinePlaceholder}
            />
            <small className="field-help">
              {domain.provider === "cloudflare"
                ? "DNS only 仅解析；Proxied 会让流量经过 Cloudflare 代理。"
                : "决定哪些网络或地区的请求使用此记录；不确定时使用默认线路。"}
            </small>
          </label>
          <label>
            TTL
            <input
              value={form.ttl}
              onChange={(event) => onChange({ ttl: event.currentTarget.value })}
              inputMode="numeric"
            />
            <small className="field-help">DNS 缓存时长（秒）；越短生效更快，但查询次数更多。</small>
          </label>
          <label>
            {weightFieldLabel}
            <input
              value={form.mx}
              onChange={(event) => onChange({ mx: event.currentTarget.value })}
              inputMode="numeric"
            />
            <small className="field-help">
              {domain.provider === "volcengine"
                ? "同线路有多条记录时的流量权重；0 表示使用供应商默认值。"
                : form.recordType === "MX"
                  ? "邮件服务器优先级，数字越小越优先。"
                  : "仅 MX 记录需要设置优先级；其它类型保持 0。"}
            </small>
          </label>
          <label>
            状态
            <select
              value={form.status}
              onChange={(event) =>
                onChange({ status: event.currentTarget.value as RecordForm["status"] })
              }
              disabled={domain.provider === "cloudflare"}
            >
              <option value="ENABLE">启用</option>
              <option value="DISABLE">暂停</option>
            </select>
            <small className="field-help">暂停后保留记录配置，但不再参与解析。</small>
          </label>
          <label className="span-2">
            记录值
            <input
              value={form.value}
              list="record-value-options"
              onChange={(event) => onChange({ value: event.currentTarget.value })}
              placeholder="IP、CNAME、TXT 内容或其它记录值"
              spellCheck={false}
            />
          </label>
          <label className="span-2">
            备注
            <textarea
              value={form.remark}
              onChange={(event) => onChange({ remark: event.currentTarget.value })}
              placeholder="内部备注，不影响 DNS 解析"
              spellCheck={false}
            />
          </label>
        </div>

        <div className="modal-footer">
          <button className="secondary-button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="primary-button" onClick={onCreate} disabled={busy || !desktopReady}>
            {creating ? "添加中" : "添加记录"}
          </button>
        </div>
      </section>
    </div>
  );
}
