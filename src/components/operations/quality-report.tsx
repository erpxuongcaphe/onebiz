"use client";
import type { Workspace } from "@/lib/operations/contracts";
import type {
  QualityAction,
  QualityWorkspace,
} from "@/lib/operations/quality-contracts";
import type { QualityEditor } from "./quality-editor";
import { formatDate, formatNumber } from "@/lib/format";
import s from "./quality.module.css";

export function QualityReport({
  data,
  workspace,
  busy,
  onEdit,
  onSave,
  onLegacySettings,
}: {
  data: QualityWorkspace;
  workspace: Workspace;
  busy: boolean;
  onEdit: (editor: QualityEditor) => void;
  onSave: (
    action: QualityAction,
    payload: Record<string, unknown>,
  ) => Promise<boolean>;
  onLegacySettings: () => void;
}) {
  const name = (id: string) =>
    workspace.people.find((p) => p.id === id)?.name ?? "Người dùng OneBiz";
  const ledger = data.rows as unknown as {
    id: string;
    delta: number;
    critical_delta: number;
    kind: string;
    reason: string;
    created_at: string;
    actor_name: string;
    item_title: string;
    audit_title: string;
    audit_id: string;
  }[];
  const amounts = (data.settlement?.snapshot.allocationAmounts ?? []) as {
    userId: string;
    qcCents: number;
    businessCents: number;
    shareBps: number;
  }[];
  return (
    <>
      <section className={s.section}>
        <h3>Thưởng kinh doanh riêng</h3>
        {data.business?.ready ? (
          <div className={s.grid}>
            <div>
              <p>Nguồn: {data.business.sourceName}</p>
              <p>
                Doanh thu đã xác nhận:{" "}
                <strong>
                  {formatNumber((data.business.revenueCents ?? 0) / 100)}
                </strong>{" "}
                đồng
              </p>
              <p>
                Chỉ tiêu: {formatNumber((data.business.targetCents ?? 0) / 100)}{" "}
                đồng
              </p>
            </div>
            <div>
              <p>
                Đạt chỉ tiêu:{" "}
                <strong>
                  {formatNumber((data.business.ratioBps ?? 0) / 100)}%
                </strong>
              </p>
              <p>
                Thưởng {data.settlement ? "đã chốt" : "dự kiến"}:{" "}
                <strong>
                  {formatNumber((data.business.rewardCents ?? 0) / 100)}
                </strong>{" "}
                đồng
              </p>
            </div>
          </div>
        ) : (
          <p className={s.muted}>
            {data.business?.reason ?? "Chưa đủ dữ liệu kinh doanh."}
          </p>
        )}
        {data.score.reasons.map((r) => (
          <p key={r} className={s.muted}>
            {r}
          </p>
        ))}
        <button onClick={onLegacySettings}>
          Thiết lập nguồn, chỉ tiêu và công việc
        </button>
      </section>
      {data.settlement && (
        <section className={s.section}>
          <h3>Kỳ đã chốt · phiên bản {data.settlement.revision}</h3>
          <p>
            Chốt lúc {formatDate(data.settlement.created_at)}. Số liệu gốc và
            chính sách tại thời điểm chốt được giữ nguyên.
          </p>
          <div className={s.tableScroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Quản lý</th>
                  <th className={s.numeric}>Phân bổ</th>
                  <th className={s.numeric}>Thưởng QC</th>
                  <th className={s.numeric}>Thưởng kinh doanh</th>
                </tr>
              </thead>
              <tbody>
                {amounts.map((a) => (
                  <tr key={a.userId}>
                    <td>{name(a.userId)}</td>
                    <td className={s.numeric}>
                      {formatNumber(a.shareBps / 100)}%
                    </td>
                    <td className={s.numeric}>
                      {formatNumber(a.qcCents / 100)}
                    </td>
                    <td className={s.numeric}>
                      {formatNumber(a.businessCents / 100)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className={s.section}>
        <h3>Sổ điểm QC · khoản gốc và điều chỉnh</h3>
        <div className={s.tableScroll}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Đợt / tiêu chuẩn</th>
                <th className={s.numeric}>Điểm</th>
                <th>Loại khoản</th>
                <th>Lý do / người ghi</th>
                <th>Thời điểm</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id}>
                  <td>
                    <a
                      href={`/hub?view=qc&audit=${encodeURIComponent(e.audit_id)}&period=${encodeURIComponent(workspace.period)}`}
                    >
                      {e.audit_title}
                    </a>
                    <p>{e.item_title}</p>
                  </td>
                  <td className={s.numeric}>
                    {Number(e.delta) > 0 ? "+" : ""}
                    {formatNumber(Number(e.delta))}
                    {e.critical_delta !== 0 && (
                      <p>
                        {e.critical_delta > 0
                          ? "Ghi nhận vi phạm loại thưởng"
                          : "Đảo vi phạm ghi nhầm"}
                      </p>
                    )}
                  </td>
                  <td>
                    {e.kind === "initial"
                      ? "Chấm gốc"
                      : e.kind === "reversal"
                        ? "Đảo khoản cũ"
                        : "Điều chỉnh"}
                  </td>
                  <td>
                    {e.reason}
                    <p className={s.muted}>{e.actor_name}</p>
                  </td>
                  <td>{formatDate(e.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!ledger.length && (
          <p className={s.muted}>Chưa có khoản điểm trong kỳ.</p>
        )}
      </section>
      <section className={s.section}>
        <div className={s.heading}>
          <h3>Số liệu hao hụt từ kế toán</h3>
          {data.can.accounting && (
            <button onClick={() => onEdit({ kind: "accounting" })}>
              Ghi số liệu kế toán
            </button>
          )}
        </div>
        <div className={s.tableScroll}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Phạm vi / đơn vị</th>
                <th className={s.numeric}>Tử số</th>
                <th className={s.numeric}>Mẫu số</th>
                <th className={s.numeric}>Tỷ lệ</th>
                <th>Nguồn</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {data.accounting.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.title} · {a.unit}
                  </td>
                  <td className={s.numeric}>{formatNumber(a.numerator)}</td>
                  <td className={s.numeric}>{formatNumber(a.denominator)}</td>
                  <td className={s.numeric}>
                    {formatNumber((a.numerator / a.denominator) * 100)}%
                  </td>
                  <td>{a.evidence}</td>
                  <td>
                    {a.state === "approved" ? "Đã xác nhận" : "Chờ xác nhận"}
                    {data.can.manage && a.state === "pending" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void onSave("accounting_approve", {
                            id: a.id,
                            version: a.version,
                          })
                        }
                      >
                        Xác nhận số liệu
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
