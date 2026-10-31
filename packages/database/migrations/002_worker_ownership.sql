-- Local supervisors may recover only jobs claimed by the worker they own.
ALTER TABLE import_jobs ADD COLUMN worker_instance UUID;
CREATE INDEX import_jobs_worker_idx ON import_jobs(worker_instance) WHERE status='running';
