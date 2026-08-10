import { create } from 'zustand';
import { Organization, OrgMember, OrgRole } from '@/types';

interface AppState {
  // Current organization context
  currentOrg: Organization | null;
  currentOrgRole: OrgRole | null;
  userOrgs: OrgMember[];
  
  // Actions
  setCurrentOrg: (org: Organization | null, role: OrgRole | null) => void;
  setUserOrgs: (orgs: OrgMember[]) => void;
  
  // Helpers
  canEdit: () => boolean;
  canTrigger: () => boolean;
  canManageMembers: () => boolean;
  canAddRestrictedSteps: () => boolean;
}

export const useAppStore = create<AppState>((set, get) => ({
  currentOrg: null,
  currentOrgRole: null,
  userOrgs: [],
  
  setCurrentOrg: (org, role) => set({ currentOrg: org, currentOrgRole: role }),
  setUserOrgs: (orgs) => set({ userOrgs: orgs }),
  
  // Permission helpers
  canEdit: () => {
    const role = get().currentOrgRole;
    return role === 'owner' || role === 'editor';
  },
  
  canTrigger: () => {
    const role = get().currentOrgRole;
    return role === 'owner' || role === 'editor';
  },
  
  canManageMembers: () => {
    return get().currentOrgRole === 'owner';
  },
  
  // Layer 2: Only owners can add db_write, notify, webhook triggers
  canAddRestrictedSteps: () => {
    return get().currentOrgRole === 'owner';
  },
}));
