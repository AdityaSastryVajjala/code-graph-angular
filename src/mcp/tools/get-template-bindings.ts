/**
 * MCP tool: get_template_bindings
 * Returns the component members referenced in a component's template.
 */

import { Driver } from 'neo4j-driver';

export async function getTemplateBindings(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const appDb = input['appDb'] as string;
  const componentName = (input['componentName'] as string | undefined)?.trim();
  const detail = (input['detail'] as boolean | undefined) ?? false;

  if (!componentName) {
    return { error: 'componentName is required', code: 'INVALID_INPUT' };
  }

  const session = driver.session({ database: appDb });
  try {
    const tplResult = await session.run(
      `MATCH (comp:Component {name: $componentName})-[:USES_TEMPLATE]->(t:Template)
       RETURN t LIMIT 1`,
      { componentName },
    );

    if (tplResult.records.length === 0) {
      return { error: `No template found for component '${componentName}'`, code: 'NOT_FOUND' };
    }

    const tplProps = tplResult.records[0].get('t').properties as Record<string, unknown>;

    const bindingsResult = await session.run(
      `MATCH (t:Template {id: $templateId})-[b:BINDS_TO]->(member)
       RETURN member, labels(member) AS lbls, b.bindingType AS bindingType, b.expression AS expression
       ORDER BY member.name`,
      { templateId: tplProps['id'] },
    );

    const bindings = bindingsResult.records.map((r) => {
      const memberProps = r.get('member').properties as Record<string, unknown>;
      const lbls = r.get('lbls') as string[];
      const entry: Record<string, unknown> = {
        member: memberProps['name'],
        kind: lbls.includes('Method') ? 'Method' : 'Property',
        bindingType: r.get('bindingType'),
      };
      if (detail) {
        entry['expression'] = r.get('expression');
        entry['isPublic'] = memberProps['isPublic'];
        if (lbls.includes('Method')) entry['returnType'] = memberProps['returnType'] ?? null;
        if (lbls.includes('Property')) entry['type'] = memberProps['type'] ?? null;
      }
      return entry;
    });

    return {
      component: componentName,
      template: {
        type: tplProps['templateType'],
        path: tplProps['templatePath'] ?? null,
        sourceFile: tplProps['sourceFile'],
      },
      bindings,
    };
  } finally {
    await session.close();
  }
}
