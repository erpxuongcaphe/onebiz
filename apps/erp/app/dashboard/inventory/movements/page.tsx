"use client";

import { StockMovement } from "@/components/inventory/StockMovement";

export default function StockMovementsPage() {
    return (
        <div className="max-w-4xl mx-auto pb-20">
            <div className="mb-6">
                {/* Can add Recent Transactions list here later */}
            </div>
            <StockMovement />
        </div>
    );
}
