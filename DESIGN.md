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
  chrome: "#121519"
  surface: "#1a1d22"
  raised: "#232830"
  selected: "#26364b"
  ink: "#f0f3f8"
  muted: "#adb7c6"
  line: "#343c47"
  control-line: "#566273"
typography:
  title:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "1.5625rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  welcome:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "2.375rem"
    fontWeight: 650
    lineHeight: 1.25
  heading:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 650
    lineHeight: 1.4
  body:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  secondary:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
  metadata:
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
  action-title:
    fontSize: "1.125rem"
    fontWeight: 650
    lineHeight: 1.45
  overview-title:
    fontSize: "1.0625rem"
    fontWeight: 650
    lineHeight: 1.4
  progress:
    fontSize: "1.4375rem"
    fontWeight: 650
    lineHeight: 1
  form-title:
    fontSize: "1.3125rem"
    fontWeight: 650
    lineHeight: 1.4
  compact-label:
    fontSize: "0.9375rem"
    fontWeight: 500
    lineHeight: 1.45
  mobile-title:
    fontSize: "1.625rem"
    fontWeight: 650
    lineHeight: 1.25
  mobile-welcome:
    fontSize: "1.875rem"
    fontWeight: 650
    lineHeight: 1.15
rounded:
  control: "7px"
  compact-control: "6px"
  chip: "5px"
  marker: "4px"
  input: "8px"
  panel: "10px"
  detail: "12px"
  circular-marker: "50%"
spacing:
  small: "8px"
  group: "12px"
  medium: "16px"
  content: "20px"
  section: "18px"
  surface: "20px"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "36px"
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "8px 12px"
---

# Design System: Living Playbooks

## Overview

The compact project desk replaces the rejected long page. A project owner can read recorded progress, follow the next action and connected steps, inspect tasks and evidence, open notes, answer a check-in and draft a manager message in the same desktop viewport. The supplied board sets the clarity and density bar; this is an original composition with supported actions only.

## Colors

The app owns charcoal surface tokens under `.app-shell`. Blue identifies available actions and current work; green describes recorded task completion. Counts always come from current canonical task records. White leads, blue-grey explains, and warm error text names recovery. Status has a text label or a labelled control as well as color.

The separate `.pet-window` keeps its existing light tokens, transparent ground, default Question presentation and exact approved sprite bytes. Application theme overrides must stay inside `.app-shell`.

## Typography

The desktop working surface uses Segoe UI/system sans at 14px with 1.45 line height, 25px project titles, 18px next-action titles and 14px card headings. Short provenance, status and navigation metadata uses 12-13px; notes and primary controls remain 14-16px. The first-project heading uses 38px on desktop and 30px on mobile. Titles wrap; long collections scroll inside bounded lists. No whole-app scaling or clipping to force fit.

## Layout

Desktop has a 56px header, 200px project rail, flexible desk and 290px manager track. The app occupies 100dvh with min-height:0 at each flex/grid boundary. The manager owns its internal padding and anchored composer. The desk uses 18px top, 20px horizontal and 12px bottom insets with 10-12px gaps.

Within the desk, project identity leads into a single progress/review band. The next-action card and connected steps lead to a lower task list beside files/evidence and a notes preview. A full-width check-in row follows those bounded lists; its answer actions stay outside their scroll area. Settings, connection, source/privacy, notes and evidence use reachable detail surfaces. The overview is a real project list with derived project, active-project and unanswered-question counts; it invents no cross-project completion estimate.

At <=1000px, Projects / Workspace / Chat switches surfaces. Narrow or short viewports, enlarged text and long content may reflow and scroll for accessibility. Desktop overview fitting at 1366x768 and 1440x900 is an integration acceptance gate, not a claim made by DOM tests.

## Elevation & Depth

Fine outlined/inset panels define working regions. The next-action surface carries a quiet blue tint. Detail drawers use a soft directional shadow and dialogs use a dark backdrop. No decorative glass, gradients, charts or fabricated artifacts.

## Shapes

Controls use 7-8px corners, panels 10px and focused detail surfaces 12px. Native semantic buttons, selects, progress, details and dialogs retain keyboard behavior. Pointer controls are 36px in dense desktop groups; primary forms, check-in actions and coarse-pointer controls use at least 44px. Focus is a 3px pale-blue outline with offset. Motion is limited to 160ms control feedback and respects reduced motion.

## Components

The progress band displays the actual done/total fraction, a native progress element and derived status counts. No tasks means progress unknown. Plan acceptance shares the band so it does not push the rest of the overview down. Task selectors remain guarded owner actions. Connected steps and the manager open the real task control, with a detail inspector when the trusted checklist omits that task.

Notes have a preview/open trigger and one retained editor/draft instance. Overview navigation hides the workspace instead of unmounting it. Detail open/close preserves the editor identity. Canonical check-ins omitted from the trusted layout still appear in the check-in area. Source/privacy keeps its direct header shortcut and reachable pause/revoke controls. Explicit demo mode has a compact badge whose disclosure explains synthetic provenance; the richer app-local example is constructed only after the existing runtime returns fixture=true, using the validated fixture client. It never supplies native-bridge fallback data.

## Do's and Don'ts

- Keep the next action, recorded progress, steps, task/evidence/notes regions, check-in and manager composer in the ordinary desktop viewport.
- Preserve revision checks, request tickets, durable drafts, canonical questions and held trusted layouts.
- Open real existing document/evidence records; use no decorative dead file rows or unsupported destinations.
- Keep the approved grey pixel mouse unchanged and preserve the independent native pet theme.
- Do not treat synthetic behavior/CSS checks as viewport, visual, native, model, source-read or hosted acceptance.
