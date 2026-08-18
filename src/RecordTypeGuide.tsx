import { recordTypeDefinition } from "./record-metadata";

type RecordTypeGuideProps = {
  type: string;
};

export function RecordTypeGuide({ type }: RecordTypeGuideProps) {
  const definition = recordTypeDefinition(type);

  return (
    <section className="record-type-guide span-2" aria-live="polite">
      <div>
        <strong>{definition.value} 记录</strong>
        <p>{definition.purpose}</p>
      </div>
      <dl>
        <div>
          <dt>记录值怎么填</dt>
          <dd>{definition.valueHelp}</dd>
        </div>
        {definition.example && (
          <div>
            <dt>示例</dt>
            <dd>
              <code>{definition.example}</code>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
