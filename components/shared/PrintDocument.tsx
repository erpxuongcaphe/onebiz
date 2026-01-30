import React from 'react';
import { formatCurrency } from '../../constants';

interface CompanyInfo {
    name: string;
    address?: string;
    phone?: string;
    taxCode?: string;
    logo?: string;
}

interface PrintDocumentProps {
    children: React.ReactNode;
    title: string;
    company?: CompanyInfo;
}

/**
 * Base Print Document Component
 * Cung cấp layout chuẩn cho tất cả print templates
 */
const PrintDocument: React.FC<PrintDocumentProps> = ({ children, title, company }) => {
    return (
        <div className="print-document">
            {/* Header */}
            <div className="print-header">
                <div className="company-info">
                    {company?.logo && <img src={company.logo} alt="Logo" className="company-logo" />}
                    <div>
                        <h1 className="company-name">{company?.name || 'CÔNG TY TNHH ABC'}</h1>
                        {company?.address && <p className="company-detail">{company.address}</p>}
                        {company?.phone && <p className="company-detail">ĐT: {company.phone}</p>}
                        {company?.taxCode && <p className="company-detail">MST: {company.taxCode}</p>}
                    </div>
                </div>
                <div className="document-title">
                    <h2>{title}</h2>
                </div>
            </div>

            {/* Content */}
            <div className="print-content">{children}</div>

            {/* Footer */}
            <div className="print-footer">
                <div className="signatures">
                    <div className="signature-block">
                        <p className="signature-label">Người lập phiếu</p>
                        <p className="signature-note">(Ký, ghi rõ họ tên)</p>
                    </div>
                    <div className="signature-block">
                        <p className="signature-label">Thủ kho</p>
                        <p className="signature-note">(Ký, ghi rõ họ tên)</p>
                    </div>
                    <div className="signature-block">
                        <p className="signature-label">Giám đốc</p>
                        <p className="signature-note">(Ký, đóng dấu)</p>
                    </div>
                </div>
                <div className="print-date">
                    <p>In ngày: {new Date().toLocaleDateString('vi-VN', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    })}</p>
                </div>
            </div>

            {/* Print Styles */}
            <style jsx>{`
        .print-document {
          font-family: 'Times New Roman', Times, serif;
          font-size: 13pt;
          line-height: 1.5;
          color: #000;
          background: #fff;
        }

        .print-header {
          margin-bottom: 20px;
          padding-bottom: 15px;
          border-bottom: 2px solid #000;
        }

        .company-info {
          display: flex;
          align-items: flex-start;
          gap: 15px;
          margin-bottom: 10px;
        }

        .company-logo {
          width: 80px;
          height: 80px;
          object-fit: contain;
        }

        .company-name {
          font-size: 16pt;
          font-weight: bold;
          margin: 0;
          text-transform: uppercase;
        }

        .company-detail {
          margin: 2px 0;
          font-size: 11pt;
        }

        .document-title {
          text-align: center;
          margin-top: 15px;
        }

        .document-title h2 {
          font-size: 18pt;
          font-weight: bold;
          margin: 0;
          text-transform: uppercase;
        }

        .print-content {
          min-height: 400px;
        }

        .print-footer {
          margin-top: 30px;
          page-break-inside: avoid;
        }

        .signatures {
          display: flex;
          justify-content: space-between;
          margin-top: 40px;
          margin-bottom: 20px;
        }

        .signature-block {
          text-align: center;
          min-width: 150px;
        }

        .signature-label {
          font-weight: bold;
          margin: 0 0 5px 0;
        }

        .signature-note {
          font-size: 10pt;
          font-style: italic;
          margin: 0;
          margin-bottom: 60px;
        }

        .print-date {
          text-align: right;
          font-size: 11pt;
          font-style: italic;
        }

        /* Print-specific styles */
        @media print {
          .print-document {
            width: 210mm;
            min-height: 297mm;
            padding: 15mm;
            margin: 0;
            box-shadow: none;
          }

          .print-footer {
            position: fixed;
            bottom: 15mm;
            left: 15mm;
            right: 15mm;
          }

          @page {
            size: A4 portrait;
            margin: 0;
          }

          /* Hide non-print elements */
          body > *:not(.print-document) {
            display: none !important;
          }
        }

        /* Screen preview styles */
        @media screen {
          .print-document {
            max-width: 210mm;
            min-height: 297mm;
            padding: 20px;
            margin: 20px auto;
            background: white;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          }
        }
      `}</style>
        </div>
    );
};

export default PrintDocument;
export type { CompanyInfo };
