// Composes the stage-aware context preamble for the "Ask anything" rail
// (ticket #30). Pure: turns the current stage + project view model into a short
// briefing the rail hands to its AO session (coworker.js setContext), so the
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
