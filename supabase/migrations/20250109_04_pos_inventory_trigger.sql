-- =============================================
-- Migration: POS Inventory Trigger
-- Date: 2025-01-09
-- Description: Trigger to deduct inventory when order is completed
-- =============================================

-- Function: Process Order Inventory
CREATE OR REPLACE FUNCTION process_order_inventory()
RETURNS TRIGGER AS $$
DECLARE
    v_item RECORD;
    v_current_stock NUMERIC;
    v_new_stock NUMERIC;
    v_branch_product_id UUID;
    v_order_number TEXT;
BEGIN
    -- Only proceed if status changed to 'completed'
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        
        -- Get order number for reference
        v_order_number := NEW.order_number;

        -- Loop through order items
        FOR v_item IN 
            SELECT * FROM order_items WHERE order_id = NEW.id
        LOOP
            -- Check if product exists in branch_products
            SELECT id, stock_quantity INTO v_branch_product_id, v_current_stock
            FROM branch_products 
            WHERE branch_id = NEW.branch_id AND product_id = v_item.product_id;

            -- If product tracking exists (found in branch_products)
            IF v_branch_product_id IS NOT NULL THEN
                -- Calculate new stock (allow negative)
                v_new_stock := v_current_stock - v_item.quantity;

                -- 1. Update stock level
                UPDATE branch_products
                SET 
                    stock_quantity = v_new_stock,
                    updated_at = NOW()
                WHERE id = v_branch_product_id;

                -- 2. Create inventory transaction log
                INSERT INTO inventory_transactions (
                    branch_id,
                    product_id,
                    type,
                    quantity,
                    quantity_before,
                    quantity_after,
                    unit_price,
                    total_amount,
                    reference_id,
                    note,
                    created_at
                ) VALUES (
                    NEW.branch_id,
                    v_item.product_id,
                    'sale',
                    -v_item.quantity, -- Negative for deduction
                    v_current_stock,
                    v_new_stock,
                    v_item.unit_price,
                    v_item.line_total,
                    v_order_number,
                    'Bán hàng qua POS: ' || v_order_number,
                    NOW()
                );
            ELSE
                -- If not in branch_products, maybe insert it with negative stock?
                -- For now, let's auto-create record with negative stock
                INSERT INTO branch_products (branch_id, product_id, stock_quantity)
                VALUES (NEW.branch_id, v_item.product_id, -v_item.quantity)
                RETURNING stock_quantity INTO v_new_stock;

                -- Log transaction
                INSERT INTO inventory_transactions (
                    branch_id,
                    product_id,
                    type,
                    quantity,
                    quantity_before,
                    quantity_after,
                    unit_price,
                    total_amount,
                    reference_id,
                    note,
                    created_at
                ) VALUES (
                    NEW.branch_id,
                    v_item.product_id,
                    'sale',
                    -v_item.quantity,
                    0, -- Assumed 0 before
                    -v_item.quantity,
                    v_item.unit_price,
                    v_item.line_total,
                    v_order_number,
                    'Bán hàng qua POS (New Record): ' || v_order_number,
                    NOW()
                );
            END IF;
        END LOOP;
    END IF;

    -- Handle cancellation (Refund stock?)
    -- Logic: If status changed from 'completed' to 'cancelled', we should restore stock.
    -- Assuming a simple cancellation flow.
    IF NEW.status = 'cancelled' AND OLD.status = 'completed' THEN
         -- Get order number for reference
        v_order_number := NEW.order_number;

        FOR v_item IN 
            SELECT * FROM order_items WHERE order_id = NEW.id
        LOOP
            -- Restore Stock
            UPDATE branch_products
            SET stock_quantity = stock_quantity + v_item.quantity
            WHERE branch_id = NEW.branch_id AND product_id = v_item.product_id;

            -- Log Transaction (Return)
            INSERT INTO inventory_transactions (
                    branch_id,
                    product_id,
                    type,
                    quantity,
                    quantity_before, -- Not precise but approx
                    quantity_after,
                    unit_price,
                    total_amount,
                    reference_id,
                    note
            ) 
            SELECT 
                NEW.branch_id,
                v_item.product_id,
                'return',
                v_item.quantity,
                stock_quantity - v_item.quantity, -- Current (already updated above) - added amount = old
                stock_quantity,
                v_item.unit_price,
                v_item.line_total,
                v_order_number,
                'Hủy đơn hàng: ' || v_order_number
            FROM branch_products
            WHERE branch_id = NEW.branch_id AND product_id = v_item.product_id;
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger definition
DROP TRIGGER IF EXISTS trigger_pos_inventory_deduction ON orders;
CREATE TRIGGER trigger_pos_inventory_deduction
    AFTER UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION process_order_inventory();
