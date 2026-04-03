"use client";

import { useRef, useCallback } from "react";
import Barcode from "react-barcode";

export interface BarcodeLabelData {
  code: string;
  name: string;
  price?: number;
}

interface PrintBarcodeProps {
  items: BarcodeLabelData[];
  copies?: number;
  labelWidth?: string;
  labelHeight?: string;
}

/**
 * Barcode label printer component
 * Renders barcode labels and opens print dialog
 */
export function PrintBarcode({
  items,
  copies = 1,
  labelWidth = "50mm",
  labelHeight = "30mm",
}: PrintBarcodeProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handlePrint = useCallback(() => {
    if (!containerRef.current) return;

    const printWindow = window.open("", "_blank", "width=600,height=400");
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>In mã vạch</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; }
          .label {
            width: ${labelWidth};
            height: ${labelHeight};
            display: inline-flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 2mm;
            page-break-inside: avoid;
            overflow: hidden;
          }
          .label-name {
            font-size: 8px;
            font-weight: bold;
            text-align: center;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            margin-bottom: 1px;
          }
          .label-price {
            font-size: 10px;
            font-weight: bold;
            margin-top: 1px;
          }
          svg { max-width: 100%; height: auto; }
          @media print {
            @page { size: auto; margin: 2mm; }
          }
        </style>
      </head>
      <body>
        ${containerRef.current.innerHTML}
        <script>window.onload = function() { window.print(); window.close(); }<\/script>
      </body>
      </html>
    `);
    printWindow.document.close();
  }, [labelWidth, labelHeight]);

  const allLabels = items.flatMap((item) =>
    Array.from({ length: copies }, (_, i) => ({ ...item, key: `${item.code}-${i}` }))
  );

  return (
    <>
      {/* Hidden barcode labels */}
      <div ref={containerRef} style={{ display: "none" }}>
        {allLabels.map((item) => (
          <div key={item.key} className="label">
            <div className="label-name">{item.name}</div>
            <Barcode
              value={item.code}
              width={1.2}
              height={30}
              fontSize={9}
              margin={0}
              displayValue={true}
            />
            {item.price !== undefined && (
              <div className="label-price">
                {new Intl.NumberFormat("vi-VN").format(item.price)}đ
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={handlePrint}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
      >
        In mã vạch ({items.length} sp)
      </button>
    </>
  );
}

/**
 * Single barcode display (inline, not for printing)
 */
export function BarcodeDisplay({
  value,
  width = 1.5,
  height = 40,
}: {
  value: string;
  width?: number;
  height?: number;
}) {
  if (!value) return null;
  return (
    <Barcode
      value={value}
      width={width}
      height={height}
      fontSize={11}
      margin={4}
      displayValue={true}
    />
  );
}
