'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAppStore } from '@/store/app-store';
import { 
  LayoutDashboard, 
  Workflow, 
  Users, 
  BarChart3,
  ChevronDown
} from 'lucide-react';
import { useQuery } from '@apollo/client';
import { GET_USER_ORGS } from '@/lib/graphql';
import { OrgMember } from '@/types';
import { useState } from 'react';

export function Sidebar() {
  const pathname = usePathname();
  const { currentOrg, setCurrentOrg, userOrgs, setUserOrgs } = useAppStore();
  const [orgDropdownOpen, setOrgDropdownOpen] = useState(false);
  
  const { data, loading } = useQuery(GET_USER_ORGS, {
    onCompleted: (data) => {
      const orgs = data.org_members as OrgMember[];
      setUserOrgs(orgs);
      
      // Set first org as current if none selected
      if (!currentOrg && orgs.length > 0) {
        setCurrentOrg(orgs[0].organization!, orgs[0].role);
      }
    }
  });

  const navItems = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/workflows', label: 'Workflows', icon: Workflow },
    { href: '/members', label: 'Team Members', icon: Users, ownerOnly: true },
    { href: '/usage', label: 'Usage & Quota', icon: BarChart3 },
  ];

  const { currentOrgRole, canManageMembers } = useAppStore();

  return (
    <aside className="w-64 border-r bg-gray-50 min-h-screen">
      <div className="p-4">
        {/* Organization Selector */}
        <div className="mb-6">
          <label className="text-xs text-gray-500 uppercase tracking-wider">
            Organization
          </label>
          <div className="relative mt-1">
            <button
              onClick={() => setOrgDropdownOpen(!orgDropdownOpen)}
              className="w-full flex items-center justify-between px-3 py-2 bg-white border rounded-lg text-sm hover:bg-gray-50"
            >
              <span>{currentOrg?.name || 'Select org...'}</span>
              <ChevronDown className="w-4 h-4" />
            </button>
            
            {orgDropdownOpen && (
              <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow-lg">
                {userOrgs.map((member) => (
                  <button
                    key={member.id}
                    onClick={() => {
                      setCurrentOrg(member.organization!, member.role);
                      setOrgDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between ${
                      currentOrg?.id === member.organization?.id ? 'bg-blue-50' : ''
                    }`}
                  >
                    <span>{member.organization?.name}</span>
                    <span className="text-xs text-gray-500 capitalize">{member.role}</span>
                  </button>
                ))}
                <Link
                  href="/organizations/new"
                  className="block w-full text-left px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 border-t"
                  onClick={() => setOrgDropdownOpen(false)}
                >
                  + Create Organization
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            if (item.ownerOnly && !canManageMembers()) return null;
            
            const isActive = pathname === item.href;
            const Icon = item.icon;
            
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm ${
                  isActive 
                    ? 'bg-blue-100 text-blue-700' 
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
