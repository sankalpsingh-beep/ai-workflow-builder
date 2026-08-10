'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { GET_ORG_WITH_STATS, ADD_ORG_MEMBER, GET_USER_ORGS } from '@/lib/graphql';
import { useAppStore } from '@/store/app-store';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { OrgRole } from '@/types';
import { UserPlus, Crown, Pencil, Eye, Trash2, AlertCircle } from 'lucide-react';
import { gql } from '@apollo/client';

const UPDATE_MEMBER_ROLE = gql`
  mutation UpdateMemberRole($id: uuid!, $role: org_role!) {
    update_org_members_by_pk(pk_columns: { id: $id }, _set: { role: $role }) {
      id
    }
  }
`;

const REMOVE_MEMBER = gql`
  mutation RemoveMember($id: uuid!) {
    delete_org_members_by_pk(id: $id) {
      id
    }
  }
`;

// Query to search for a user by email
const SEARCH_USER_BY_EMAIL = gql`
  query SearchUserByEmail($email: String!) {
    users(where: { email: { _eq: $email } }) {
      id
      email
      displayName
    }
  }
`;

export default function MembersPage() {
  const { currentOrg, canManageMembers } = useAppStore();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('viewer');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  
  const { data, loading, refetch, client } = useQuery(GET_ORG_WITH_STATS, {
    variables: { orgId: currentOrg?.id },
    skip: !currentOrg?.id,
  });
  
  const [addMember] = useMutation(ADD_ORG_MEMBER, {
    onCompleted: () => {
      refetch();
      setShowInvite(false);
      setInviteEmail('');
      setInviteRole('viewer');
      setInviteError(null);
    },
    onError: (error) => {
      // Handle unique constraint violations (user already a member)
      if (error.message.includes('unique') || error.message.includes('Uniqueness violation')) {
        setInviteError('This user is already a member of this organization');
      } else {
        setInviteError(error.message);
      }
    },
    refetchQueries: [{ query: GET_USER_ORGS }],
  });
  
  const [updateRole] = useMutation(UPDATE_MEMBER_ROLE, {
    onCompleted: () => refetch(),
  });
  
  const [removeMember] = useMutation(REMOVE_MEMBER, {
    onCompleted: () => refetch(),
    refetchQueries: [{ query: GET_USER_ORGS }],
  });

  const members = data?.organizations_by_pk?.members || [];

  const handleUpdateRole = async (memberId: string, newRole: OrgRole) => {
    await updateRole({ variables: { id: memberId, role: newRole } });
  };

  const handleRemoveMember = async (memberId: string) => {
    if (confirm('Remove this member from the organization?')) {
      await removeMember({ variables: { id: memberId } });
    }
  };

  const handleAddMember = async () => {
    if (!inviteEmail.trim()) {
      setInviteError('Please enter a user email or ID');
      return;
    }
    
    setInviteError(null);
    setInviteLoading(true);
    
    try {
      let userId = inviteEmail.trim();
      
      // Check if input looks like a UUID (user ID) or an email
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
      
      if (!isUUID) {
        // Try to find user by email
        const { data: userData } = await client.query({
          query: SEARCH_USER_BY_EMAIL,
          variables: { email: userId.toLowerCase() },
          fetchPolicy: 'network-only',
        });
        
        if (!userData?.users?.length) {
          setInviteError('No user found with that email address. Make sure they have an account first.');
          setInviteLoading(false);
          return;
        }
        
        userId = userData.users[0].id;
      }
      
      // Check if user is already a member
      const existingMember = members.find((m: any) => m.user?.id === userId);
      if (existingMember) {
        setInviteError('This user is already a member of this organization');
        setInviteLoading(false);
        return;
      }
      
      // Add the member
      await addMember({
        variables: {
          orgId: currentOrg?.id,
          userId: userId,
          role: inviteRole,
        },
      });
    } catch (error: any) {
      setInviteError(error.message || 'Failed to add member');
    } finally {
      setInviteLoading(false);
    }
  };

  const roleIcons = {
    owner: <Crown className="w-4 h-4 text-yellow-500" />,
    editor: <Pencil className="w-4 h-4 text-blue-500" />,
    viewer: <Eye className="w-4 h-4 text-gray-500" />,
  };

  if (!currentOrg) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Select an organization first</p>
      </div>
    );
  }

  if (!canManageMembers()) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Only owners can manage team members</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Team Members</h1>
        <Button onClick={() => setShowInvite(true)}>
          <UserPlus className="w-4 h-4 mr-2" />
          Add Member
        </Button>
      </div>

      {/* Member List */}
      <div className="bg-white rounded-lg border">
        <div className="divide-y">
          {members.map((member: any) => (
            <div key={member.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                  {member.user?.email?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium">{member.user?.displayName || member.user?.email}</p>
                  <p className="text-sm text-gray-500">{member.user?.email}</p>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  {roleIcons[member.role as OrgRole]}
                  <Select
                    value={member.role}
                    onChange={(e) => handleUpdateRole(member.id, e.target.value as OrgRole)}
                    options={[
                      { value: 'owner', label: 'Owner' },
                      { value: 'editor', label: 'Editor' },
                      { value: 'viewer', label: 'Viewer' },
                    ]}
                    className="w-28"
                  />
                </div>
                
                <button
                  onClick={() => handleRemoveMember(member.id)}
                  className="p-2 hover:bg-red-50 text-red-500 rounded"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Role Permissions Info */}
      <div className="bg-blue-50 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2">Role Permissions</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li><strong>Owner:</strong> Full control - manage members, create/edit workflows, add all step types, trigger runs</li>
          <li><strong>Editor:</strong> Create/edit workflows, trigger runs - cannot manage members or add db_write/notify steps</li>
          <li><strong>Viewer:</strong> View-only access - cannot trigger runs or make changes</li>
        </ul>
      </div>

      {/* Invite Modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">Add Team Member</h2>
            <p className="text-sm text-gray-500 mb-4">
              Enter the email address of the person you want to add. They must already have an account.
            </p>
            
            {inviteError && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg flex items-start gap-2">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <span className="text-sm">{inviteError}</span>
              </div>
            )}
            
            <div className="space-y-4">
              <Input
                label="Email Address"
                type="email"
                value={inviteEmail}
                onChange={(e) => {
                  setInviteEmail(e.target.value);
                  setInviteError(null);
                }}
                placeholder="colleague@example.com"
              />
              <Select
                label="Role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as OrgRole)}
                options={[
                  { value: 'viewer', label: 'Viewer - Read-only access' },
                  { value: 'editor', label: 'Editor - Can create and run workflows' },
                  { value: 'owner', label: 'Owner - Full control' },
                ]}
              />
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button 
                variant="secondary" 
                onClick={() => {
                  setShowInvite(false);
                  setInviteError(null);
                  setInviteEmail('');
                  setInviteRole('viewer');
                }}
              >
                Cancel
              </Button>
              <Button 
                onClick={handleAddMember}
                loading={inviteLoading}
                disabled={!inviteEmail.trim()}
              >
                Add Member
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
