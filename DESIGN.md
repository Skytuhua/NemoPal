---
name: Living Playbooks
description: A precise project desk with quiet controls and an original local pet.
colors:
  surface: "#ffffff"
  chrome: "#f4f5f3"
  ink: "#252826"
  muted: "#5d655f"
  line: "#d2d7d1"
  focus: "#295b42"
  error: "#8c3029"
  selected: "#e2e7e0"
typography:
  title:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "1.85rem"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  heading:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 650
    lineHeight: 1.4
  body:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  control: "5px"
  pet-bubble: "12px"
spacing:
  small: "8px"
  group: "12px"
  medium: "16px"
  section: "24px"
  surface: "32px"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
    height: "44px"
---

# Design System: Living Playbooks

## Overview
The project desk keeps work and its provenance visible. Familiar controls, fine separators, and neutral surfaces serve repeated owner decisions. Warmth belongs to the original local pet, whose expression reflects trusted desktop state.

## Colors
White is the working surface; quiet warm gray identifies sidebar and chat. Dark ink leads, muted text explains provenance and capability, forest focus outlines identify keyboard location, and brick text identifies errors. State uses words as well as color. Source freshness, cloud connection, and Nemotron availability remain separate lines.

## Typography
One system sans family throughout. Titles are 1.85rem (1.6rem below 900px), section headings 1.15rem, body 14px and secondary labels .86rem. Prose is limited to 72ch. Product controls use ordinary sentence case.

## Layout
Desktop columns are 208px / flexible workspace / 296px. At 1100px the side columns become 176px / 260px. Below 900px, explicit Projects/Workspace/Chat buttons select one surface. Sections use 24px spacing and working surfaces use 20–48px horizontal padding. Native page scrolling avoids stacked independent scrollbars.

## Elevation & Depth
Flat tonal layers and one-pixel separators establish hierarchy. The workspace does not use decorative shadows. Pet background remains transparent for desktop composition.

## Shapes
Controls have 5px corners and at least 44px height. A 12px pet bubble is the sole soft container. The original pebble pet has six expression drawings and small local animations; both OS and local reduced-motion settings stop motion.

## Components
Six trusted flat panel variants use stable IDs. Tasks expose native status selects, evidence expands through native details, documents use revision-checked textareas, and question actions name their outcome. Draft and conflict text stays separate from layout. Owner application gates structural rearrangement while editing. Source consent is an inline fieldset with local scope, filtering acknowledgment, export policy and named receiving endpoint.

## Do's and Don'ts
- Do keep the center useful without chat, preserve editor identity, and show explicit unavailable states.
- Do keep keyboard focus visible with a 3px outline and pair state labels with canonical provenance.
- Don't add decorative rails, gradients, structural emoji, fake progress percentages, or remote artwork.
- Don't treat synthetic browser evidence as native, provider, or hosted acceptance.
