-- Fix finalized_by column type to match users.id (VARCHAR instead of UUID)
-- The users table uses VARCHAR(20) for id, but finalized_by was incorrectly defined as UUID

ALTER TABLE monthly_salaries 
ALTER COLUMN finalized_by TYPE VARCHAR(20) USING finalized_by::VARCHAR(20);

-- Add comment for clarity
COMMENT ON COLUMN monthly_salaries.finalized_by IS 'User ID who finalized this payroll (VARCHAR to match users.id)';
