import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { api } from '../api/client';
import { canonicalGithubUrl } from '../api/schemas';
import { Button, ErrorState } from './ui';

/** Shared by the launch doorway and real workspace. Always uses the active API adapter. */
export default function RepositoryConnection({ id = 'repository-url' }: { id?: string }) {
  const [url, setUrl] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const navigate = useNavigate();
  const canonical = canonicalGithubUrl(url);
  const importer = useMutation({
    mutationFn: api.import,
    onSuccess: (data) =>
      navigate(
        `/app/repositories/${encodeURIComponent(data.repoId)}?job=${encodeURIComponent(data.jobId)}`,
      ),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (canonical) importer.mutate(canonical);
  };
  return (
    <div className="repository-connection">
      <form onSubmit={submit} noValidate>
        <label htmlFor={id}>Public GitHub repository URL</label>
        <div className="input-action">
          <input
            id={id}
            type="url"
            placeholder="https://github.com/owner/repository"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            aria-invalid={submitted && !canonical}
            aria-describedby={`${id}-hint`}
            autoComplete="url"
          />
          <Button type="submit" disabled={importer.isPending}>
            {importer.isPending ? 'Connecting…' : 'Connect'}
            <ArrowUpRight size={17} />
          </Button>
        </div>
        <p className={submitted && !canonical ? 'field-error' : 'field-hint'} id={`${id}-hint`}>
          {submitted && !canonical
            ? 'Enter a public https://github.com/owner/repository URL.'
            : 'Public repositories · JavaScript & TypeScript · Read-only analysis'}
        </p>
      </form>
      {importer.error && (
        <ErrorState error={importer.error} retry={() => canonical && importer.mutate(canonical)} />
      )}
    </div>
  );
}
