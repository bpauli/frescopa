// Composes what the "Ask anything" rail says on the producer's behalf: the
// stage-aware context preamble (ticket #30) and the "Add to chat" payloads the
// panels hand over. Pure: it turns view-model data into text the rail feeds to
// its AO session (coworker.js setContext) or prefills into the input, so the
// assistant's answers are grounded in where the producer is and what they have
// chosen. Every part is optional - it includes only what exists so far.

/**
 * @param {{stage?: string, stageIndex?: number, status?: string}} stage
 * @param {{meta?: object, keywords?: Array, creativeDirection?: object, brief?: object}} project
 * @returns {string} the context preamble, or '' when there is nothing to say
 */
export function composeContext(stage, project) {
  if (!project) return '';
  const lines = [
    'You are the Coworker assistant embedded in the Adobe Experience Workspace '
    + '"Coworker Projects" app, helping a web producer build an SEO page. '
    + 'Ground your answers in the project context below.',
  ];

  const title = project.meta?.title;
  if (title) lines.push(`Project: ${title}.`);
  if (stage?.stage) {
    lines.push(`Current stage: ${stage.stage} (Stage ${stage.stageIndex}), status ${stage.status}.`);
  }

  const keywords = project.keywords || [];
  const primary = keywords.find((k) => k.role === 'primary');
  if (primary) lines.push(`Primary keyword: ${primary.text}.`);
  const secondary = keywords.filter((k) => k.role === 'secondary').map((k) => k.text);
  if (secondary.length) lines.push(`Secondary keywords: ${secondary.join(', ')}.`);

  const cd = project.creativeDirection || {};
  const cdParts = [];
  if (cd.baseTemplate?.name) cdParts.push(`base template "${cd.baseTemplate.name}"`);
  if (cd.visualStyle?.name) cdParts.push(`visual style "${cd.visualStyle.name}"`);
  if (cd.colorPalette?.name) cdParts.push(`color palette "${cd.colorPalette.name}"`);
  if (cdParts.length) lines.push(`Creative direction: ${cdParts.join(', ')}.`);

  const brief = project.brief || {};
  if (brief.title || brief.body) {
    const body = (brief.body || '').slice(0, 800);
    lines.push(`Page brief${brief.title ? ` "${brief.title}"` : ''}: ${body}`);
  }

  return lines.join('\n');
}

// How an asset handed over from the Stage 5 detail view (ticket #62) is framed
// in the rail input. The brief's own lead stays the rail's default.
export const ASSET_CHAT_LEAD = 'Here is an image on my page - help me change it:';

/**
 * The "Add to chat" payload for ONE Stage 5 asset (ticket #62): the facts of
 * that image, so the producer can ask for a change without retyping what the
 * picture is. Only what the row carries is included - an absent field is left
 * out rather than sent as an empty label. Pure.
 * @param {{slot?: number, alt?: string, description?: string, visualStyle?: string,
 *   palette?: string, aspect?: string, prompt?: string}} asset
 * @param {string} [title] - the asset's display title (asset-detail-logic.js)
 * @returns {string} the message body, or '' when there is nothing to say
 */
export function composeAssetMessage(asset, title) {
  if (!asset) return '';
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  const lines = [];
  const name = text(title);
  const slot = Number(asset.slot);
  if (name) lines.push(`Image: ${name}`);
  if (Number.isFinite(slot)) lines.push(`Slot: ${Math.round(slot)} (its position on the page).`);
  if (text(asset.alt)) lines.push(`ALT text: ${text(asset.alt)}`);
  if (text(asset.description)) lines.push(`What it shows: ${text(asset.description)}`);
  const look = [
    text(asset.visualStyle) && `visual style "${text(asset.visualStyle)}"`,
    text(asset.palette) && `palette "${text(asset.palette)}"`,
    text(asset.aspect) && `${text(asset.aspect)} crop`,
  ].filter(Boolean);
  if (look.length) lines.push(`Look: ${look.join(', ')}.`);
  if (text(asset.prompt)) lines.push(`Prompt it was generated from: ${text(asset.prompt)}`);
  return lines.join('\n');
}
