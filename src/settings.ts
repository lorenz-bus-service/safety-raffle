/** Parses settings written as in a .env file: NAME=value lines, # comments, optional quotes. */
export function parseSettings(text: string): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim().replace(/^export\s+/, '');
    let value = line.slice(separator + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) value = value.slice(1, -1);
    settings[name] = value;
  }
  return settings;
}

export interface SecretSource {
  getVariable(path: string): Promise<string>;
  getResource(path: string): Promise<unknown>;
}

/**
 * Replaces references to values held elsewhere, so secrets need not be written in the settings text:
 *   $var:f/samsara/production          the value of a Windmill variable or secret
 *   $res:f/resend/windmill#api_key     one field of a Windmill resource
 */
export async function resolveReferences(settings: Record<string, string>, source: SecretSource): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};
  for (const [name, value] of Object.entries(settings)) {
    if (value.startsWith('$var:')) {
      resolved[name] = await source.getVariable(value.slice(5).trim());
    } else if (value.startsWith('$res:')) {
      const [path, field] = value.slice(5).split('#').map((part) => part.trim());
      if (!path || !field) throw new Error(`${name}: a resource reference is written $res:path#field`);
      const resource = (await source.getResource(path)) as Record<string, unknown> | null;
      const found = resource?.[field];
      if (typeof found !== 'string' && typeof found !== 'number') throw new Error(`${name}: resource ${path} has no field "${field}"`);
      resolved[name] = String(found);
    } else {
      resolved[name] = value;
    }
  }
  return resolved;
}
