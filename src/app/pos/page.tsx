"use client";

import { usePosState } from "./hooks/use-pos-state";
import { PosTopBar } from "./components/pos-top-bar";
import { ProductGrid } from "./components/product-grid";
import { CartPanel } from "./components/cart-panel";
import { ShippingForm } from "./components/shipping-form";
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

      {/* Main Content — Layout depends on sale mode */}
      <div className="flex-1 flex min-h-0">
        {/*
          Bán nhanh: Cart only (no product grid, search is inside cart)
          Bán thường: Product Grid + Cart
          Giao hàng: Product Grid + Cart + Shipping Form
        */}

        {/* Product Grid — hidden in quick mode */}
        {pos.saleMode !== "quick" && (
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
        )}

        {/* Cart Panel — always visible */}
        <CartPanel
          saleMode={pos.saleMode}
          mobileView={pos.mobileView}
          activeTab={pos.activeTab}
          cart={pos.cart}
          customerSearch={pos.customerSearch}
          subtotal={pos.subtotal}
          orderDiscountAmount={pos.orderDiscountAmount}
          couponDiscountAmount={pos.couponDiscountAmount}
          totalDiscount={pos.totalDiscount}
          shippingFee={pos.shippingFee}
          discountType={pos.discountType}
          discountValue={pos.discountValue}
          showDiscountInput={pos.showDiscountInput}
          totalDue={pos.totalDue}
          customerPayment={pos.customerPayment}
          customerPaymentNum={pos.customerPaymentNum}
          changeAmount={pos.changeAmount}
          paymentMethod={pos.paymentMethod}
          couponCode={pos.couponCode}
          appliedCoupon={pos.appliedCoupon}
          couponError={pos.couponError}
          onSetCouponCode={pos.setCouponCode}
          onApplyCoupon={pos.applyCoupon}
          onRemoveCoupon={pos.removeCoupon}
          searchRef={pos.searchRef}
          searchQuery={pos.searchQuery}
          filteredProducts={pos.filteredProducts}
          addedProductId={pos.addedProductId}
          onSearchChange={pos.setSearchQuery}
          onAddToCart={pos.addToCart}
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

        {/* Shipping Form — only in delivery mode */}
        {pos.saleMode === "delivery" && (
          <ShippingForm
            shipping={pos.shipping}
            onUpdateShipping={pos.updateShipping}
            mobileView={pos.mobileView}
          />
        )}
      </div>

      {/* Mobile Floating Cart/Search Button */}
      <MobileCartToggle
        mobileView={pos.mobileView}
        cartItemCount={pos.cartItemCount}
        saleMode={pos.saleMode}
        onSetMobileView={pos.setMobileView}
      />
    </div>
  );
}
