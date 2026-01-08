-- Add department column to review_criteria
-- Allows criteria to be department-specific
-- NULL = applies to all departments

ALTER TABLE review_criteria 
ADD COLUMN IF NOT EXISTS department VARCHAR(100) DEFAULT NULL;

-- Create index for faster department lookups
CREATE INDEX IF NOT EXISTS idx_review_criteria_department ON review_criteria(department);

COMMENT ON COLUMN review_criteria.department IS 'Department this criteria applies to. NULL means all departments.';
