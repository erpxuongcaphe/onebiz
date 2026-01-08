-- Performance Review System
-- Hệ thống đánh giá hiệu suất nhân viên

-- =====================================================
-- 1. REVIEW CYCLES (Chu kỳ đánh giá)
-- =====================================================
CREATE TABLE IF NOT EXISTS review_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    review_deadline DATE NOT NULL,
    cycle_type VARCHAR(20) DEFAULT 'quarterly', -- monthly, quarterly, annually
    status VARCHAR(20) DEFAULT 'draft', -- draft, active, completed, cancelled
    created_by VARCHAR(20) REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- 2. REVIEW CRITERIA (Tiêu chí đánh giá)
-- =====================================================
CREATE TABLE IF NOT EXISTS review_criteria (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL, -- performance, attitude, skills, teamwork
    weight DECIMAL(5,2) DEFAULT 1.0, -- Trọng số
    max_score INTEGER DEFAULT 5,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default criteria
INSERT INTO review_criteria (name, description, category, weight) VALUES
    ('Hoàn thành công việc', 'Mức độ hoàn thành các nhiệm vụ được giao', 'performance', 2.0),
    ('Chất lượng công việc', 'Độ chính xác và chất lượng kết quả', 'performance', 2.0),
    ('Đúng giờ', 'Tuân thủ thời gian làm việc', 'attitude', 1.0),
    ('Thái độ làm việc', 'Sự nhiệt tình và trách nhiệm', 'attitude', 1.5),
    ('Kỹ năng chuyên môn', 'Trình độ và kỹ năng nghề nghiệp', 'skills', 1.5),
    ('Khả năng học hỏi', 'Tiếp thu kiến thức và kỹ năng mới', 'skills', 1.0),
    ('Làm việc nhóm', 'Khả năng phối hợp với đồng nghiệp', 'teamwork', 1.0),
    ('Giao tiếp', 'Kỹ năng giao tiếp và trình bày', 'teamwork', 1.0)
ON CONFLICT DO NOTHING;

-- =====================================================
-- 3. PERFORMANCE REVIEWS (Kết quả đánh giá)
-- =====================================================
CREATE TABLE IF NOT EXISTS performance_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id UUID NOT NULL REFERENCES review_cycles(id) ON DELETE CASCADE,
    employee_id VARCHAR(50) NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    reviewer_id VARCHAR(20) REFERENCES users(id),
    review_type VARCHAR(20) DEFAULT 'manager', -- self, manager, peer
    status VARCHAR(20) DEFAULT 'pending', -- pending, submitted, reviewed, final
    overall_score DECIMAL(5,2),
    overall_rating VARCHAR(20), -- excellent, good, average, needs_improvement, poor
    strengths TEXT,
    improvements TEXT,
    goals TEXT,
    manager_comments TEXT,
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(cycle_id, employee_id, review_type)
);

-- =====================================================
-- 4. REVIEW SCORES (Điểm chi tiết từng tiêu chí)
-- =====================================================
CREATE TABLE IF NOT EXISTS review_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id UUID NOT NULL REFERENCES performance_reviews(id) ON DELETE CASCADE,
    criteria_id UUID NOT NULL REFERENCES review_criteria(id),
    score INTEGER CHECK (score >= 0 AND score <= 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(review_id, criteria_id)
);

-- =====================================================
-- 5. INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_review_cycles_status ON review_cycles(status);
CREATE INDEX IF NOT EXISTS idx_reviews_employee ON performance_reviews(employee_id);
CREATE INDEX IF NOT EXISTS idx_reviews_cycle ON performance_reviews(cycle_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON performance_reviews(status);

-- =====================================================
-- 6. ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE review_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_scores ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "review_cycles_read" ON review_cycles FOR SELECT USING (true);
CREATE POLICY "review_cycles_admin" ON review_cycles FOR ALL USING (true);

CREATE POLICY "review_criteria_read" ON review_criteria FOR SELECT USING (true);
CREATE POLICY "review_criteria_admin" ON review_criteria FOR ALL USING (true);

CREATE POLICY "reviews_read" ON performance_reviews FOR SELECT USING (true);
CREATE POLICY "reviews_admin" ON performance_reviews FOR ALL USING (true);

CREATE POLICY "scores_read" ON review_scores FOR SELECT USING (true);
CREATE POLICY "scores_admin" ON review_scores FOR ALL USING (true);

-- =====================================================
-- 7. FUNCTION to calculate overall rating
-- =====================================================
CREATE OR REPLACE FUNCTION calculate_review_rating(p_score DECIMAL)
RETURNS VARCHAR(20) AS $$
BEGIN
    IF p_score >= 4.5 THEN
        RETURN 'excellent';
    ELSIF p_score >= 3.5 THEN
        RETURN 'good';
    ELSIF p_score >= 2.5 THEN
        RETURN 'average';
    ELSIF p_score >= 1.5 THEN
        RETURN 'needs_improvement';
    ELSE
        RETURN 'poor';
    END IF;
END;
$$ LANGUAGE plpgsql;
