-- 1. Add new Foreign Key columns
ALTER TABLE employees 
ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id),
ADD COLUMN IF NOT EXISTS position_id UUID REFERENCES positions(id);

-- 2. Migrate existing data (Department)
UPDATE employees
SET department_id = departments.id
FROM departments
WHERE employees.department = departments.name;

-- 3. Migrate existing data (Position)
UPDATE employees 
SET position_id = positions.id
FROM positions
WHERE employees.position = positions.name;

-- 4. Create index for performance
CREATE INDEX IF NOT EXISTS idx_employees_department_id ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_position_id ON employees(position_id);
