'use client';

import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { useRouter } from 'next/navigation';
import { useUserId } from '@nhost/nextjs';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { CREATE_ORG, ADD_ORG_MEMBER, GET_USER_ORGS } from '@/lib/graphql';

export default function NewOrganizationPage() {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const router = useRouter();
  const userId = useUserId();
  
  const [createOrg, { loading: creatingOrg }] = useMutation(CREATE_ORG);
  const [addMember, { loading: addingMember }] = useMutation(ADD_ORG_MEMBER, {
    refetchQueries: [{ query: GET_USER_ORGS }],
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      // Create organization
      const { data } = await createOrg({
        variables: { name, slug: slug.toLowerCase().replace(/\s+/g, '-') },
      });
      
      // Add current user as owner
      await addMember({
        variables: {
          orgId: data.insert_organizations_one.id,
          userId,
          role: 'owner',
        },
      });
      
      router.push('/');
    } catch (error) {
      console.error('Error creating organization:', error);
    }
  };

  const generateSlug = (value: string) => {
    return value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  };

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Create Organization</h1>
      
      <div className="bg-white rounded-lg border p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Organization Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slug) setSlug(generateSlug(e.target.value));
            }}
            placeholder="My Company"
            required
          />
          
          <Input
            label="Slug (URL-friendly)"
            value={slug}
            onChange={(e) => setSlug(generateSlug(e.target.value))}
            placeholder="my-company"
            required
          />
          
          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.back()}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              loading={creatingOrg || addingMember}
            >
              Create Organization
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
