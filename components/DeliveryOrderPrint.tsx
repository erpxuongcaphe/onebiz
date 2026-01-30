import React from 'react';
import PrintDocument, { type CompanyInfo } from './shared/PrintDocument';
import { type DeliveryOrder } from '../lib/deliveryOrders';

interface DeliveryOrderPrintProps {
    delivery: DeliveryOrder;
    company?: CompanyInfo;
}

const DeliveryOrderPrint: React.FC<DeliveryOrderPrintProps> = ({ delivery, company }) => {
    return (
        <PrintDocument title="PHIẾU GIAO HÀNG" company={company}>
            {/* Delivery Info */}
            <div className="delivery-info">
                <div className="info-row">
                    <div className="info-col">
                        <strong>Số phiếu:</strong> <span className="delivery-number">{delivery.delivery_number}</span>
                    </div>
                    <div className="info-col">
                        <strong>Ngày:</strong> {new Date(delivery.delivery_date).toLocaleDateString('vi-VN')}
                    </div>
                </div>
                {delivery.sales_order_number && (
                    <div className="info-row">
                        <div className="info-col">
                            <strong>Đơn hàng:</strong> {delivery.sales_order_number}
                        </div>
                    </div>
                )}
                <div className="info-row">
                    <div className="info-col">
                        <strong>Khách hàng:</strong> {delivery.customer?.name || delivery.customer_name}
                    </div>
                    <div className="info-col">
                        {delivery.customer?.phone && (
                            <>
                                <strong>ĐT:</strong> {delivery.customer.phone}
                            </>
                        )}
                    </div>
                </div>
                {delivery.shipping_address && (
                    <div className="info-row">
                        <div className="info-col full-width">
                            <strong>Địa chỉ giao:</strong> {delivery.shipping_address}
                        </div>
                    </div>
                )}
                <div className="info-row">
                    <div className="info-col">
                        {delivery.receiver_name && (
                            <>
                                <strong>Người nhận:</strong> {delivery.receiver_name}
                            </>
                        )}
                    </div>
                    <div className="info-col">
                        {delivery.receiver_phone && (
                            <>
                                <strong>SĐT người nhận:</strong> {delivery.receiver_phone}
                            </>
                        )}
                    </div>
                </div>
                {delivery.warehouse_name && (
                    <div className="info-row">
                        <div className="info-col">
                            <strong>Kho xuất:</strong> {delivery.warehouse_name}
                        </div>
                    </div>
                )}
            </div>

            {/* Items Table */}
            <table className="items-table">
                <thead>
                    <tr>
                        <th style={{ width: '40px' }}>STT</th>
                        <th style={{ width: '120px' }}>Mã SP</th>
                        <th>Tên sản phẩm</th>
                        <th style={{ width: '80px', textAlign: 'center' }}>Đơn vị</th>
                        <th style={{ width: '80px', textAlign: 'right' }}>Số lượng</th>
                        <th style={{ width: '120px' }}>Ghi chú</th>
                    </tr>
                </thead>
                <tbody>
                    {(delivery.items || []).map((item, idx) => (
                        <tr key={item.id}>
                            <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                            <td>{item.product_sku || '-'}</td>
                            <td>{item.product_name || 'N/A'}</td>
                            <td style={{ textAlign: 'center' }}>-</td>
                            <td style={{ textAlign: 'right', fontWeight: '600' }}>{item.quantity}</td>
                            <td>{item.notes || ''}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Summary */}
            <div className="summary-section">
                <p>
                    <strong>Tổng số mặt hàng:</strong> {delivery.items?.length || 0}
                </p>
                <p>
                    <strong>Tổng số lượng:</strong>{' '}
                    {(delivery.items || []).reduce((sum, item) => sum + item.quantity, 0)}
                </p>
            </div>

            {/* Delivery Notes */}
            {delivery.delivery_notes && (
                <div className="notes-section">
                    <strong>Ghi chú giao hàng:</strong>
                    <p>{delivery.delivery_notes}</p>
                </div>
            )}

            {delivery.notes && (
                <div className="notes-section">
                    <strong>Ghi chú:</strong>
                    <p>{delivery.notes}</p>
                </div>
            )}

            {/* Instructions */}
            <div className="instructions-section">
                <p>
                    <strong>Hướng dẫn nhận hàng:</strong>
                </p>
                <ul>
                    <li>Kiểm tra số lượng, chủng loại hàng hóa khi nhận</li>
                    <li>Ký xác nhận vào phiếu giao hàng nếu đồng ý</li>
                    <li>Liên hệ ngay với bộ phận giao hàng nếu có vấn đề</li>
                </ul>
            </div>

            {/* Signatures - Custom for Delivery */}
            <div className="delivery-signatures">
                <div className="signature-block">
                    <p className="signature-label">Người giao hàng</p>
                    <p className="signature-note">(Ký, ghi rõ họ tên)</p>
                    <div className="signature-space"></div>
                </div>
                <div className="signature-block">
                    <p className="signature-label">Người nhận hàng</p>
                    <p className="signature-note">(Ký, ghi rõ họ tên)</p>
                    <div className="signature-space"></div>
                    <p className="signature-time">
                        Thời gian nhận: ______ giờ ______ ngày ____/____/______
                    </p>
                </div>
            </div>

            {/* Styles */}
            <style jsx>{`
        .delivery-info {
          margin: 20px 0;
          font-size: 12pt;
        }

        .info-row {
          display: flex;
          gap: 40px;
          margin: 8px 0;
        }

        .info-col {
          flex: 1;
        }

        .info-col.full-width {
          flex: 2;
        }

        .delivery-number {
          font-weight: bold;
          font-size: 14pt;
          color: #000;
        }

        .items-table {
          width: 100%;
          border-collapse: collapse;
          margin: 20px 0;
          font-size: 11pt;
        }

        .items-table th,
        .items-table td {
          border: 1px solid #333;
          padding: 8px 6px;
        }

        .items-table th {
          background-color: #f0f0f0;
          font-weight: bold;
          text-align: left;
        }

        .items-table tbody tr:nth-child(even) {
          background-color: #fafafa;
        }

        .summary-section {
          margin: 20px 0;
          padding: 10px;
          background-color: #f5f5f5;
          border-left: 3px solid #333;
          font-size: 12pt;
        }

        .summary-section p {
          margin: 5px 0;
        }

        .notes-section {
          margin: 15px 0;
          padding: 10px;
          background-color: #fffef0;
          border-left: 3px solid #ffa500;
        }

        .notes-section p {
          margin: 5px 0 0 0;
          white-space: pre-wrap;
        }

        .instructions-section {
          margin: 20px 0;
          padding: 10px;
          background-color: #f0f8ff;
          border: 1px dashed #333;
          font-size: 11pt;
        }

        .instructions-section p {
          margin: 0 0 5px 0;
          font-weight: bold;
        }

        .instructions-section ul {
          margin: 5px 0;
          padding-left: 25px;
        }

        .instructions-section li {
          margin: 3px 0;
        }

        .delivery-signatures {
          display: flex;
          justify-content: space-around;
          margin-top: 40px;
          page-break-inside: avoid;
        }

        .delivery-signatures .signature-block {
          text-align: center;
          min-width: 200px;
        }

        .delivery-signatures .signature-label {
          font-weight: bold;
          margin: 0 0 5px 0;
          font-size: 12pt;
        }

        .delivery-signatures .signature-note {
          font-size: 10pt;
          font-style: italic;
          margin: 0;
        }

        .delivery-signatures .signature-space {
          height: 80px;
          border-bottom: 1px solid #999;
          margin: 20px 10px 10px 10px;
        }

        .delivery-signatures .signature-time {
          font-size: 10pt;
          margin-top: 10px;
        }

        @media print {
          .items-table th {
            background-color: #e0e0e0 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .items-table tbody tr:nth-child(even) {
            background-color: #f5f5f5 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .summary-section,
          .notes-section,
          .instructions-section {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
        </PrintDocument>
    );
};

export default DeliveryOrderPrint;
