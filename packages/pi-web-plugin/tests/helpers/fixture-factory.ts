export interface TeamFixtureMember {
  name: string;
  role: string;
}

export interface OrchestrationLogFixtureEntry {
  agentName: string;
  task: string;
  modifiedAt?: Date;
}

export interface DecisionsFixtureEntry {
  heading: string;
  detail?: string;
}

export function buildTeamFixture(members: TeamFixtureMember[]): string {
  const rows = members.map(({ name, role }) => `| ${name} | ${role} |`).join("\n");

  return [
    "# Team",
    "",
    "## Members",
    "",
    "| Name | Role |",
    "| --- | --- |",
    rows,
    "",
  ].join("\n");
}

export function buildOrchestrationLogFixture(entries: OrchestrationLogFixtureEntry[]): Map<string, string> {
  const sortedEntries = [...entries].sort((left, right) => {
    const leftTime = left.modifiedAt?.getTime() ?? 0;
    const rightTime = right.modifiedAt?.getTime() ?? 0;
    return rightTime - leftTime || left.agentName.localeCompare(right.agentName);
  });

  return new Map(sortedEntries.map((entry, index) => {
    const filename = `${String(index).padStart(4, "0")}-${slugify(entry.agentName)}.md`;
    const lines = [
      `# ${entry.agentName} — ${entry.task}`,
      "",
      `**Agent:** ${entry.agentName}`,
      `**Action:** ${entry.task}`,
    ];

    if (entry.modifiedAt !== undefined) {
      lines.push(`**Date:** ${entry.modifiedAt.toISOString()}`);
    }

    lines.push("");
    return [filename, lines.join("\n")];
  }));
}

export function buildDecisionsFixture(decisions: DecisionsFixtureEntry[]): string {
  const sections = decisions.flatMap(({ heading, detail }) => {
    const lines = [`## ${heading}`];
    if (detail !== undefined && detail.trim() !== "") {
      lines.push("", detail.trim());
    }
    lines.push("");
    return lines;
  });

  return ["# Decisions", "", ...sections].join("\n");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "entry";
}
