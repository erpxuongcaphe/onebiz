import React from 'react';
import PrintDocument, { type CompanyInfo } from './shared/PrintDocument';
import { type SalesOrder } from '../lib/salesOrders';
import { formatCurrency } from '../constants';

interface SalesOrderPrintProps {
    order: SalesOrder;
    company?: CompanyInfo;
}

const SalesOrderPrint: React.FC<SalesOrderPrintProps> = ({ order, company }) => {
    return (
        <PrintDocument title="ĐơN BÁN HÀNG" company={company}>
            {/* Order Info */}
            <div className="order-info">
                <div className="info-row">
                    <div className="info-col">
                        <strong>Số đơn:</strong> <span className="order-number">{order.order_number}</span>
                    </div>
                    <div className="info-col">
                        <strong>Ngày:</strong> {new Date(order.order_date).toLocaleDateString('vi-VN')}
                    </div>
                </div>
                <div className="info-row">
                    <div className="info-col">
                        <strong>Khách hàng:</strong> {order.customer?.name || order.customer_name}
                    </div>
                    <div className="info-col">
                        {order.customer?.phone && (
                            <>
                                <strong>ĐT:</strong> {order.customer.phone}
                            </>
                        )}
                    </div>
                </div>
                {order.warehouse_name && (
                    <div className="info-row">
                        <div className="info-col">
                            <strong>Kho xuất:</strong> {order.warehouse_name}
                        </div>
                    </div>
                )}
                {order.expected_delivery_date && (
                    <div className="info-row">
                        <div className="info-col">
                            <strong>Ngày giao dự kiến:</strong>{' '}
                            {new Date(order.expected_delivery_date).toLocaleDateString('vi-VN')}
                        </div>
                    </div>
                )}
            </div>

            {/* Items Table */}
            <table className="items-table">
                <thead>
                    <tr>
                        <th style={{ width: '40px' }}>STT</th>
                        <th style={{ width: '100px' }}>Mã SP</th>
                        <th>Tên sản phẩm</th>
                        <th style={{ width: '60px', textAlign: 'right' }}>SL</th>
                        <th style={{ width: '100px', textAlign: 'right' }}>Đơn giá</th>
                        <th style={{ width: '80px', textAlign: 'right' }}>CK (%)</th>
                        <th style={{ width: '100px', textAlign: 'right' }}>Thành tiền</th>
                    </tr>
                </thead>
                <tbody>
                    {(order.items || []).map((item, idx) => {
                        const lineTotal = item.quantity * item.unit_price * (1 - item.discount_percent / 100);
                        return (
                            <tr key={item.id}>
                                <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                                <td>{item.product_sku || '-'}</td>
                                <td>{item.product_name || 'N/A'}</td>
                                <td style={{ textAlign: 'right' }}>{item.quantity}</td>
                                <td style={{ textAlign: 'right' }}>{formatCurrency(item.unit_price)}</td>
                                <td style={{ textAlign: 'right' }}>{item.discount_percent}%</td>
                                <td style={{ textAlign: 'right', fontWeight: '600' }}>{formatCurrency(lineTotal)}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            {/* Totals */}
            <div className="totals-section">
                <div className="totals-row">
                    <span className="totals-label">Tạm tính:</span>
                    <span className="totals-value">{formatCurrency(order.subtotal)}</span>
                </div>
                {order.discount > 0 && (
                    <div className="totals-row">
                        <span className="totals-label">Chiết khấu:</span>
                        <span className="totals-value discount">-{formatCurrency(order.discount)}</span>
                    </div>
                )}
                {order.tax > 0 && (
                    <div className="totals-row">
                        <span className="totals-label">Thuế VAT:</span>
                        <span className="totals-value">{formatCurrency(order.tax)}</span>
                    </div>
                )}
                <div className="totals-row total">
                    <span className="totals-label">Tổng cộng:</span>
                    <span className="totals-value">{formatCurrency(order.total)}</span>
                </div>
                <div className="total-in-words">
                    <em>Bằng chữ: {numberToVietnameseWords(order.total)}</em>
                </div>
            </div>

            {/* Notes */}
            {order.notes && (
                <div className="notes-section">
                    <strong>Ghi chú:</strong>
                    <p>{order.notes}</p>
                </div>
            )}

            {/* Terms */}
            <div className="terms-section">
                <p className="terms-note">
                    <strong>Lưu ý:</strong> Quý khách vui lòng kiểm tra kỹ hàng hóa khi nhận. Hàng đã bán không nhận lại.
                </p>
            </div>

            {/* Styles */}
            <style jsx>{`
        .order-info {
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

        .order-number {
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

        .totals-section {
          margin: 20px 0;
          margin-left: auto;
          max-width: 350px;
          font-size: 12pt;
        }

        .totals-row {
          display: flex;
          justify-content: space-between;
          padding: 5px 0;
          border-bottom: 1px solid #ddd;
        }

        .totals-row.total {
          border-top: 2px solid #000;
          border-bottom: 2px solid #000;
          font-weight: bold;
          font-size: 13pt;
          padding: 8px 0;
          margin-top: 5px;
        }

        .totals-label {
          font-weight: 500;
        }

        .totals-value {
          font-family: 'Courier New', monospace;
          font-weight: 600;
        }

        .totals-value.discount {
          color: #d00;
        }

        .total-in-words {
          margin-top: 10px;
          font-size: 11pt;
        }

        .notes-section {
          margin: 20px 0;
          padding: 10px;
          background-color: #f9f9f9;
          border-left: 3px solid #333;
        }

        .notes-section p {
          margin: 5px 0 0 0;
          white-space: pre-wrap;
        }

        .terms-section {
          margin: 20px 0;
          font-size: 10pt;
        }

        .terms-note {
          font-style: italic;
          margin: 0;
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

          .notes-section {
            background-color: #f0f0f0 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
        </PrintDocument>
    );
};

/**
 * Convert number to Vietnamese words (simplified)
 */
function numberToVietnameseWords(num: number): string {
    if (num === 0) return 'Không đồng';

    const ones = ['', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
    const units = ['', 'nghìn', 'triệu', 'tỷ'];

    const roundedNum = Math.round(num);

    if (roundedNum >= 1000000000) {
        const billions = Math.floor(roundedNum / 1000000000);
        const remainder = roundedNum % 1000000000;
        const millions = Math.floor(remainder / 1000000);

        let result = `${billions} tỷ`;
        if (millions > 0) {
            result += ` ${millions} triệu`;
        }
        return result + ' đồng chẵn';
    }

    if (roundedNum >= 1000000) {
        const millions = Math.floor(roundedNum / 1000000);
        const remainder = roundedNum % 1000000;
        const thousands = Math.floor(remainder / 1000);

        let result = `${millions} triệu`;
        if (thousands > 0) {
            result += ` ${thousands} nghìn`;
        }
        return result + ' đồng chẵn';
    }

    if (roundedNum >= 1000) {
        const thousands = Math.floor(roundedNum / 1000);
        return `${thousands} nghìn đồng chẵn`;
    }

    return `${roundedNum} đồng`;
}

export default SalesOrderPrint;
