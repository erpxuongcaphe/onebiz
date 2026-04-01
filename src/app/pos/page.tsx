"use client";

import { usePosState } from "./hooks/use-pos-state";
import { PosTopBar } from "./components/pos-top-bar";
import { ProductGrid } from "./components/product-grid";
import { CartPanel } from "./components/cart-panel";
import { MobileCartToggle } from "./components/mobile-cart-toggle";

export default function PosPage() {
  const pos = usePosState();

  return (
    <div className="flex flex-col h-full">
      {/* Top Bar */}
      <PosTopBar
        tabs={pos.tabs}
        activeTabId={pos.activeTabId}
        saleMode={pos.saleMode}
        currentTime={pos.currentTime}
        onSwitchTab={pos.switchTab}
        onCloseTab={pos.closeTab}
        onAddTab={pos.addTab}
        onSetSaleMode={pos.setSaleMode}
      />

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* Left Panel - Products */}
        <ProductGrid
          searchRef={pos.searchRef}
          searchQuery={pos.searchQuery}
          selectedCategory={pos.selectedCategory}
          filteredProducts={pos.filteredProducts}
          addedProductId={pos.addedProductId}
          mobileView={pos.mobileView}
          onSearchChange={pos.setSearchQuery}
          onSelectCategory={pos.setSelectedCategory}
          onAddToCart={pos.addToCart}
        />

        {/* Right Panel - Cart */}
        <CartPanel
          mobileView={pos.mobileView}
          activeTab={pos.activeTab}
          cart={pos.cart}
          customerSearch={pos.customerSearch}
          subtotal={pos.subtotal}
          discountAmount={pos.discountAmount}
          discountType={pos.discountType}
          discountValue={pos.discountValue}
          showDiscountInput={pos.showDiscountInput}
          totalDue={pos.totalDue}
          customerPayment={pos.customerPayment}
          customerPaymentNum={pos.customerPaymentNum}
          changeAmount={pos.changeAmount}
          paymentMethod={pos.paymentMethod}
          onSetCustomerSearch={pos.setCustomerSearch}
          onUpdateQuantity={pos.updateQuantity}
          onUpdatePrice={pos.updatePrice}
          onUpdateItemDiscount={pos.updateItemDiscount}
          onRemoveFromCart={pos.removeFromCart}
          onSetDiscountType={pos.setDiscountType}
          onSetDiscountValue={pos.setDiscountValue}
          onSetShowDiscountInput={pos.setShowDiscountInput}
          onSetCustomerPayment={pos.setCustomerPayment}
          onSetPaymentMethod={pos.setPaymentMethod}
          onCheckout={pos.handleCheckout}
        />
      </div>

      {/* Mobile Floating Cart Button */}
      <MobileCartToggle
        mobileView={pos.mobileView}
        cartItemCount={pos.cartItemCount}
        onSetMobileView={pos.setMobileView}
      />
    </div>
  );
}
