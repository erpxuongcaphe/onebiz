import { supabaseUntyped as supabase } from "@/lib/supabase";
import {
    Product,
    Category,
    Unit,
    CreateProductInput,
    UpdateProductInput,
    UpdateStockInput,
    BranchProduct,
} from "@/lib/types/inventory";

// --- Categories & Units ---

export async function getCategories(): Promise<Category[]> {
    const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('is_active', true)
        .order('name');

    if (error) throw error;
    return data || [];
}

export async function getUnits(): Promise<Unit[]> {
    const { data, error } = await supabase
        .from('units')
        .select('*')
        .eq('is_active', true)
        .order('name');

    if (error) throw error;
    return data || [];
}

// --- Products ---

export async function getProducts(
    branchId: string,
    filters?: { categoryId?: string; search?: string; type?: string }
): Promise<Product[]> {
    let query = supabase
        .from('products')
        .select(`
            *,
            category:categories(*),
            unit:units(*),
            inventory:branch_products!left(*)
        `)
        .eq('is_active', true)
        .eq('branch_products.branch_id', branchId);

    if (filters?.categoryId) {
        query = query.eq('category_id', filters.categoryId);
    }

    if (filters?.type) {
        query = query.eq('type', filters.type);
    }

    if (filters?.search) {
        query = query.ilike('name', `%${filters.search}%`);
    }

    const { data, error } = await query.order('name');

    if (error) throw error;

    // Transform to handle array return from join if necessary, 
    // though Supabase single join usually returns object or null.
    // The filter on inventory makes sure we only get the relevant branch stock.
    return (data || []).map(item => ({
        ...item,
        inventory: Array.isArray(item.inventory) ? item.inventory[0] : item.inventory
    }));
}

export async function getProductById(id: string): Promise<Product | null> {
    const { data, error } = await supabase
        .from('products')
        .select(`
            *,
            category:categories(*),
            unit:units(*)
        `)
        .eq('id', id)
        .single();

    if (error) throw error;
    return data;
}

export async function createProduct(product: CreateProductInput): Promise<Product> {
    const { data, error } = await supabase
        .from('products')
        .insert([product])
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function updateProduct(id: string, updates: UpdateProductInput): Promise<Product> {
    const { data, error } = await supabase
        .from('products')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function deleteProduct(id: string): Promise<void> {
    // Soft delete
    const { error } = await supabase
        .from('products')
        .update({ is_active: false })
        .eq('id', id);

    if (error) throw error;
}

// --- Inventory & Stock ---

export async function getBranchInventory(branchId: string): Promise<BranchProduct[]> {
    const { data, error } = await supabase
        .from('branch_products')
        .select(`
            *,
            product:products(*)
        `)
        .eq('branch_id', branchId);

    if (error) throw error;
    return data || [];
}

export async function updateStock(input: UpdateStockInput): Promise<void> {
    // This should ideally be a stored procedure or transaction to ensure consistency
    // For now, we'll implement client-side logic but it's risky for concurrency (race conditions).
    // TODO: Move to critical logic to Postgres Function later for better safety.

    try {
        // 1. Get current stock
        const { data: currentStock, error: stockError } = await supabase
            .from('branch_products')
            .select('*')
            .eq('branch_id', input.branch_id)
            .eq('product_id', input.product_id)
            .single(); // Might be null if first time

        let quantityBefore = 0;
        let quantityAfter = input.quantity_change;

        if (currentStock) {
            quantityBefore = currentStock.stock_quantity;
            quantityAfter = Number(currentStock.stock_quantity) + Number(input.quantity_change);
        } else if (!stockError) {
            // If no record but no error (just empty), treat as 0
        }

        // 2. Insert Transaction Record
        const { error: transError } = await supabase
            .from('inventory_transactions')
            .insert([{
                branch_id: input.branch_id,
                product_id: input.product_id,
                type: input.type,
                quantity: input.quantity_change,
                quantity_before: quantityBefore,
                quantity_after: quantityAfter,
                unit_price: input.unit_price,
                total_amount: input.unit_price ? (input.unit_price * Math.abs(input.quantity_change)) : 0,
                reference_id: input.reference_id,
                note: input.note
            }]);

        if (transError) throw transError;

        // 3. Update Branch Product Stock
        const { error: updateError } = await supabase
            .from('branch_products')
            .upsert({
                branch_id: input.branch_id,
                product_id: input.product_id,
                stock_quantity: quantityAfter,
                // Only update average cost if buying/importing? Simplified for now.
                last_checked_at: new Date().toISOString()
            }, { onConflict: 'branch_id,product_id' });

        if (updateError) throw updateError;

    } catch (err) {
        console.error("Stock update failed:", err);
        throw err;
    }
}
