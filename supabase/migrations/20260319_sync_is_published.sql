-- Keep is_published in sync with status column
CREATE OR REPLACE FUNCTION sync_is_published()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_published := (NEW.status = 'published');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_is_published
  BEFORE INSERT OR UPDATE OF status ON forms
  FOR EACH ROW
  EXECUTE FUNCTION sync_is_published();

-- Fix any existing rows where is_published is out of sync
UPDATE forms SET is_published = (status = 'published')
WHERE is_published != (status = 'published');
