import { useState } from 'react';
import { ArrowRight, FileCode2, GitBranch, Link2 } from 'lucide-react';
import { Badge, Eyebrow } from '../ui';
const steps = [
  {
    label: 'The change',
    file: 'auth.ts',
    kind: 'PROPOSED CHANGE',
    title: 'Begin with the file you want to change.',
    detail:
      'The file is a starting point. Dependency paths describe which importers could be affected; they do not establish that a bug will occur.',
    code: "// Illustrative input\nchangedFiles: ['src/auth.ts']",
  },
  {
    label: 'Direct impact',
    file: 'session.ts',
    kind: 'ONE REVERSE IMPORT',
    title: 'One import. One step from the change.',
    detail:
      'A direct dependent imports the changed file. The displayed impact flows toward the dependent; the source proof keeps the original import direction.',
    code: "// Illustrative source: src/session.ts\nimport { refreshToken } from './auth'",
  },
  {
    label: 'Further out',
    file: 'dashboard.tsx',
    kind: 'TWO REVERSE IMPORTS',
    title: 'Follow the route, beyond the first hop.',
    detail:
      'A transitive dependent reaches the changed file through another import. Each step must come from a returned structural path, with source evidence attached.',
    code: "// Illustrative source: src/dashboard.tsx\nimport { session } from './session'\n// session.ts → auth.ts",
  },
  {
    label: 'Another signal',
    file: 'Co-changed files',
    kind: 'HISTORICAL ASSOCIATION',
    title: 'Changed together does not mean depends on.',
    detail:
      'A historical association can suggest another place to investigate. It stays separate from the structural dependency path and never becomes an invented import edge.',
    code: '// Separate historical signal\nco-change ≠ structural dependency',
  },
];
export default function ConsequenceStory() {
  const [step, setStep] = useState(0);
  return (
    <div className="consequence-story" data-step={step}>
      <nav aria-label="Explore the illustrative change">
        <span>FOLLOW THE RIPPLE</span>
        {steps.map((item, index) => (
          <button key={item.label} aria-pressed={step === index} onClick={() => setStep(index)}>
            <b>0{index + 1}</b>
            {item.label}
            <ArrowRight size={12} />
          </button>
        ))}
      </nav>
      <div className="story-propagation">
        <svg viewBox="0 0 1000 230" preserveAspectRatio="none" aria-hidden="true">
          <path
            className={step >= 1 ? 'is-lit' : ''}
            pathLength="1"
            d="M125 70 C300 70 225 70 500 70"
          />
          <path
            className={step >= 2 ? 'is-lit' : ''}
            pathLength="1"
            d="M500 70 C700 70 700 70 875 70"
          />
          <path
            className={`association-path ${step === 3 ? 'is-lit' : ''}`}
            pathLength="1"
            d="M125 70 C350 70 280 195 500 195"
          />
        </svg>
        {steps.map((item, index) => (
          <button
            key={item.label}
            className={`story-record record-${index} ${step === index ? 'selected' : ''} ${step >= index && index < 3 ? 'reached' : ''}`}
            aria-pressed={step === index}
            onClick={() => setStep(index)}
          >
            <span>
              {index === 3 ? <Link2 size={17} /> : <FileCode2 size={17} />} {item.kind}
            </span>
            <strong>{item.file}</strong>
            <small>
              {index === 0
                ? 'INPUT'
                : index === 3
                  ? 'SEPARATE SIGNAL'
                  : `${index} HOP${index === 2 ? 'S' : ''}`}
            </small>
          </button>
        ))}
      </div>
      <div className="story-proof" aria-live="polite">
        <div>
          <Eyebrow>
            <GitBranch size={14} />
            INSPECT THE MECHANISM / 0{step + 1}
          </Eyebrow>
          <h3>{steps[step].title}</h3>
          <p>{steps[step].detail}</p>
        </div>
        <div className="story-code">
          <header>
            <i />
            <span>ILLUSTRATIVE EXAMPLE / NOT REPOSITORY EVIDENCE</span>
          </header>
          <pre>
            <code>{steps[step].code}</code>
          </pre>
          <Badge>INSPECTABLE REASONING STARTS WITH A SOURCE.</Badge>
        </div>
      </div>
    </div>
  );
}
