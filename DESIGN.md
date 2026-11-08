---
name: Living Playbooks
description: A calm project desk that makes the next useful action easy to find.
colors:
  action: "#286cde"
  action-hover: "#2266d2"
  focus: "#93c2ff"
  success: "#85d6a7"
  error: "#ffb1ad"
  error-surface: "#352326"
  chrome: "#151619"
  surface: "#1b1d21"
  raised: "#24272d"
  selected: "#2b3442"
  ink: "#f1f2f4"
  muted: "#b0b6c0"
  line: "#383d46"
  control-line: "#626b79"
typography:
  title:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 2.5vw, 2.25rem)"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  welcome:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "clamp(2rem, 4vw, 3rem)"
    fontWeight: 650
    lineHeight: 1.2
  heading:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 650
    lineHeight: 1.4
  body:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  secondary:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  control: "8px"
  progress: "4px"
  pet-bubble: "12px"
spacing:
  small: "8px"
  group: "12px"
  medium: "16px"
  content: "20px"
  section: "28px"
  surface: "32px"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    height: "44px"
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "10px 12px"
---

# Design System: Living Playbooks

## Overview

The project desk uses restrained charcoal layers and clear working space. Familiar navigation, direct actions and plain language carry the interface. The supplied board establishes atmosphere; this product has its own composition and only supported destinations. The approved grey pixel mouse adds a small friendly presence.

## Colors

Blue identifies an available primary action; pale blue identifies keyboard focus and supporting actions. White leads and soft grey explains. Green represents recorded task progress, never service readiness or assumed success. Errors use readable warm text on a quiet dark surface. State always has a text label.

The separate native pet window retains its incumbent light bubble and transparent background. Its existing scoped variables are deliberately distinct from the project desk.

## Typography

One system sans family follows the Windows application setting. Body text is 16px; secondary text is 14px, with 12–13px reserved for short provenance/navigation metadata. Working headings step through 18, 20 and 24px; project titles are fluid 28–36px. The first-project welcome reaches 48px on desktop and reduces to 28px on a narrow screen. Copy wraps rather than truncates; body measure is capped at 72ch.

## Layout

Desktop uses a 224px project list, a majority-width working surface and a 312px manager panel. At 1200px the side panels narrow to 192px and 280px. Below 1000px, Projects / Workspace / Chat selects one visible surface. The overview and create form use the space normally occupied by the manager panel. Main gutters are fluid with 20px on mobile; forms are capped at 660px. Page scrolling remains native.

## Elevation & Depth

Flat tonal layers and fine separators provide depth. No decorative shadows or glass. Working sections sit directly on the page instead of repeating a card grid.

## Shapes

Native controls have soft 8px corners and at least 44px target height. Consistent authored 20px outline icons accompany labels. The mouse uses the original sprite's first cell, pixelated at display size, with no new animation or alteration of its bytes.

## Components

Projects shows real names, goals, plan state and unanswered questions; no invented dashboard totals. The workspace orders next action, tasks, check-in, notes, milestones and evidence, preserving stable panel/editor identity. Task progress is a native progress element backed by actual done/total counts and a visible count label; unknown stays unknown.

Project settings, connection details and source permissions use native disclosures. The header's Sources & privacy shortcut opens and focuses the source controls directly. Consent and stop/revoke actions retain their existing semantics. Chat explains unavailability and offers the useful work still supported. Drafts remain editable and recoverable. Focus rings are 3px; control feedback is 160ms and disabled under reduced motion.

## Do's and Don'ts

- Keep the open project and next action visible; retain keyboard and draft behavior across navigation.
- Label demo/synthetic mode explicitly and keep source, connection and model status distinct.
- Preserve the approved mouse asset; do not infer a pet redesign from this workspace redesign.
- Do not add unsupported Reports, Templates, integrations, fabricated dates, percentages or completion claims.
- Do not interpret headless fixture checks as native, provider, production or user visual acceptance.
