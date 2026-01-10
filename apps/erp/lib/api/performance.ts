/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from '../supabase';

// Note: These tables are created via migrations but not in database.types.ts
// Using 'as any' for Supabase calls until types are regenerated

// =====================================================
// Types
// =====================================================
export type ReviewCycleType = 'monthly' | 'quarterly' | 'annually';
export type ReviewCycleStatus = 'draft' | 'active' | 'completed' | 'cancelled';
export type ReviewType = 'self' | 'manager' | 'peer';
export type ReviewStatus = 'pending' | 'submitted' | 'reviewed' | 'final';
export type RatingLevel = 'excellent' | 'good' | 'average' | 'needs_improvement' | 'poor';

export type ReviewCycle = {
    id: string;
    name: string;
    description: string | null;
    start_date: string;
    end_date: string;
    review_deadline: string;
    cycle_type: ReviewCycleType;
    status: ReviewCycleStatus;
    created_by: string | null;
    created_at: string;
    updated_at: string;
};

export type ReviewCriteria = {
    id: string;
    name: string;
    description: string | null;
    category: string;
    weight: number;
    max_score: number;
    is_active: boolean;
    created_at: string;
};

export type PerformanceReview = {
    id: string;
    cycle_id: string;
    employee_id: string;
    reviewer_id: string | null;
    review_type: ReviewType;
    status: ReviewStatus;
    overall_score: number | null;
    overall_rating: RatingLevel | null;
    strengths: string | null;
    improvements: string | null;
    goals: string | null;
    manager_comments: string | null;
    submitted_at: string | null;
    reviewed_at: string | null;
    created_at: string;
    updated_at: string;
    // Joined
    cycle?: ReviewCycle;
    employee?: { id: string; name: string; department: string; position: string };
    reviewer?: { id: string; full_name: string };
    scores?: ReviewScore[];
};

export type ReviewScore = {
    id: string;
    review_id: string;
    criteria_id: string;
    score: number | null;
    comment: string | null;
    created_at: string;
    criteria?: ReviewCriteria;
};

// =====================================================
// Review Cycles CRUD
// =====================================================
export async function getReviewCycles(status?: ReviewCycleStatus): Promise<ReviewCycle[]> {
    let query = supabase
        .from('review_cycles')
        .select('*')
        .order('created_at', { ascending: false });

    if (status) {
        query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as ReviewCycle[];
}

export async function getReviewCycleById(id: string): Promise<ReviewCycle | null> {
    const { data, error } = await supabase
        .from('review_cycles')
        .select('*')
        .eq('id', id)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return data as ReviewCycle;
}

export async function createReviewCycle(cycle: Partial<ReviewCycle>): Promise<ReviewCycle> {
    const { data, error } = await supabase
        .from('review_cycles')
        .insert(cycle as any)
        .select()
        .single();

    if (error) throw error;
    return data as ReviewCycle;
}

export async function updateReviewCycle(id: string, updates: Partial<ReviewCycle>): Promise<ReviewCycle> {
    const { data, error } = await supabase
        .from('review_cycles')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data as ReviewCycle;
}

// =====================================================
// Review Criteria
// =====================================================
export async function getReviewCriteria(options?: {
    activeOnly?: boolean;
    department?: string;
}): Promise<ReviewCriteria[]> {
    const { activeOnly = true, department } = options || {};

    let query = supabase
        .from('review_criteria')
        .select('*')
        .order('category')
        .order('name');

    if (activeOnly) {
        query = query.eq('is_active', true);
    }

    // Filter by department: get criteria for specific department OR null (all departments)
    if (department) {
        query = query.or(`department.is.null,department.eq.${department}`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as ReviewCriteria[];
}

export async function createReviewCriteria(criteria: {
    name: string;
    category: string;
    weight: number;
    max_score?: number;
    description?: string;
    department?: string | null;
}): Promise<ReviewCriteria> {
    const { data, error } = await supabase
        .from('review_criteria')
        .insert({
            ...criteria,
            max_score: criteria.max_score || 5,
            is_active: true,
            department: criteria.department || null,
        } as any)
        .select()
        .single();

    if (error) throw error;
    return data as any as ReviewCriteria;
}

export async function updateReviewCriteria(
    id: string,
    updates: Partial<Pick<ReviewCriteria, 'name' | 'category' | 'weight' | 'max_score' | 'description' | 'is_active'> & { department?: string | null }>
): Promise<ReviewCriteria> {
    const { data, error } = await supabase
        .from('review_criteria')
        .update(updates as any)
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data as any as ReviewCriteria;
}

export async function deleteReviewCriteria(id: string): Promise<void> {
    const { error } = await supabase
        .from('review_criteria')
        .delete()
        .eq('id', id);

    if (error) throw error;
}


// =====================================================
// Performance Reviews
// =====================================================
export async function getPerformanceReviews(filters?: {
    cycleId?: string;
    employeeId?: string;
    status?: ReviewStatus;
}): Promise<PerformanceReview[]> {
    let query = supabase
        .from('performance_reviews')
        .select(`
            *,
            cycle:review_cycles(*),
            employee:employees(id, name, department, position),
            reviewer:users!performance_reviews_reviewer_id_fkey(id, full_name)
        `)
        .order('created_at', { ascending: false });

    if (filters?.cycleId) {
        query = query.eq('cycle_id', filters.cycleId);
    }
    if (filters?.employeeId) {
        query = query.eq('employee_id', filters.employeeId);
    }
    if (filters?.status) {
        query = query.eq('status', filters.status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []) as any as PerformanceReview[];
}

export async function getPerformanceReviewById(id: string): Promise<PerformanceReview | null> {
    const { data, error } = await supabase
        .from('performance_reviews')
        .select(`
            *,
            cycle:review_cycles(*),
            employee:employees(id, name, department, position),
            reviewer:users!performance_reviews_reviewer_id_fkey(id, full_name),
            scores:review_scores(*, criteria:review_criteria(*))
        `)
        .eq('id', id)
        .single();

    if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
    }
    return data as any as PerformanceReview;
}

export async function createPerformanceReview(review: {
    cycle_id: string;
    employee_id: string;
    reviewer_id?: string;
    review_type: ReviewType;
}): Promise<PerformanceReview> {
    const { data, error } = await supabase
        .from('performance_reviews')
        .insert(review as any)
        .select()
        .single();

    if (error) throw error;
    return data as any as PerformanceReview;
}

// Add multiple employees to a review cycle at once
export async function addEmployeesToCycle(
    cycleId: string,
    employeeIds: string[],
    reviewerId?: string
): Promise<PerformanceReview[]> {
    const reviews = employeeIds.map(employeeId => ({
        cycle_id: cycleId,
        employee_id: employeeId,
        reviewer_id: reviewerId || null,
        review_type: 'annual' as ReviewType,
        status: 'draft' as ReviewStatus,
    }));

    const { data, error } = await supabase
        .from('performance_reviews')
        .insert(reviews as any)
        .select();

    if (error) throw error;
    return (data || []) as any as PerformanceReview[];
}

export async function submitReviewScores(
    reviewId: string,
    scores: Array<{ criteria_id: string; score: number; comment?: string }>,
    additionalData?: {
        strengths?: string;
        improvements?: string;
        goals?: string;
    }
): Promise<PerformanceReview> {
    // Insert/update scores
    for (const score of scores) {
        await supabase
            .from('review_scores')
            .upsert({
                review_id: reviewId,
                criteria_id: score.criteria_id,
                score: score.score,
                comment: score.comment || null
            });
    }

    // Calculate overall score
    const criteria = await getReviewCriteria();
    let totalWeight = 0;
    let weightedSum = 0;

    for (const score of scores) {
        const crit = criteria.find(c => c.id === score.criteria_id);
        if (crit) {
            weightedSum += score.score * crit.weight;
            totalWeight += crit.weight;
        }
    }

    const overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const overallRating = calculateRating(overallScore);

    // Update review
    const { data, error } = await supabase
        .from('performance_reviews')
        .update({
            overall_score: overallScore,
            overall_rating: overallRating,
            strengths: additionalData?.strengths || null,
            improvements: additionalData?.improvements || null,
            goals: additionalData?.goals || null,
            status: 'submitted',
            submitted_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq('id', reviewId)
        .select()
        .single();

    if (error) throw error;
    return data as any as PerformanceReview;
}

export async function finalizeReview(
    reviewId: string,
    managerComments: string
): Promise<PerformanceReview> {
    const { data, error } = await supabase
        .from('performance_reviews')
        .update({
            manager_comments: managerComments,
            status: 'final',
            reviewed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq('id', reviewId)
        .select()
        .single();

    if (error) throw error;
    return data as any as PerformanceReview;
}

// =====================================================
// Helper Functions
// =====================================================
export function calculateRating(score: number): RatingLevel {
    if (score >= 4.5) return 'excellent';
    if (score >= 3.5) return 'good';
    if (score >= 2.5) return 'average';
    if (score >= 1.5) return 'needs_improvement';
    return 'poor';
}

export function getRatingLabel(rating: RatingLevel): string {
    const labels: Record<RatingLevel, string> = {
        excellent: 'Xuất sắc',
        good: 'Tốt',
        average: 'Trung bình',
        needs_improvement: 'Cần cải thiện',
        poor: 'Yếu'
    };
    return labels[rating];
}

export function getRatingColor(rating: RatingLevel): string {
    const colors: Record<RatingLevel, string> = {
        excellent: 'bg-green-100 text-green-800',
        good: 'bg-blue-100 text-blue-800',
        average: 'bg-amber-100 text-amber-800',
        needs_improvement: 'bg-orange-100 text-orange-800',
        poor: 'bg-red-100 text-red-800'
    };
    return colors[rating];
}

export function getStatusLabel(status: ReviewStatus): string {
    const labels: Record<ReviewStatus, string> = {
        pending: 'Chờ đánh giá',
        submitted: 'Đã nộp',
        reviewed: 'Đã duyệt',
        final: 'Hoàn thành'
    };
    return labels[status];
}

export function getCycleStatusLabel(status: ReviewCycleStatus): string {
    const labels: Record<ReviewCycleStatus, string> = {
        draft: 'Bản nháp',
        active: 'Đang diễn ra',
        completed: 'Hoàn thành',
        cancelled: 'Đã hủy'
    };
    return labels[status];
}
