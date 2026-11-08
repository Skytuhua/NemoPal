import React from 'react';
import { createRoot } from 'react-dom/client';
import type { PetChatBridge, PetChatState } from '@living-playbooks/contracts';
import { PetChat } from '../../apps/web/src/pet/PetChat';
import { createDraftStore } from '../../apps/web/src/features/documents/drafts';
import { snapshot } from './helpers';

const s = snapshot();
const initial: PetChatState = { type: 'pet_chat_state', version: 1, contextId: s.project.id, visible: true, expanded: false, reducedMotion: true, conversation: { draftScope: 'synthetic-owner-project', projectId: s.project.id, projectRevision: 0, eventSequence: 0, managerName: 'Nemo', messages: [], checkIn: null, connected: true, inference: { available: true }, demoTiming: false } };
let listener: (state: PetChatState) => void = () => {};
const acknowledgements: unknown[] = [];
const bridge: PetChatBridge = { read: async () => initial, invoke: async input => { acknowledgements.push(input); return undefined; }, onEvent(fn) { listener = fn; return () => {}; } };
const element = document.createElement('div'); document.body.replaceChildren(element);
createRoot(element).render(<PetChat bridge={bridge} store={createDraftStore()} />);
Object.assign(window, { petStorageTest: { initial, acknowledgements, emit: (value: PetChatState) => listener(value), read: () => createDraftStore().read('pet-chat:synthetic-owner-project:draft') } });
