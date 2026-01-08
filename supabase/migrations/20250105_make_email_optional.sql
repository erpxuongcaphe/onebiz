-- Make email column optional (allow NULL)
ALTER TABLE employees ALTER COLUMN email DROP NOT NULL;
