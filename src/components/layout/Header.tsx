'use client';

import { useUserData, useSignOut } from '@nhost/nextjs';
import { useAppStore } from '@/store/app-store';
import { LogOut, Settings, User } from 'lucide-react';
import Link from 'next/link';

export function Header() {
  const user = useUserData();
  const { signOut } = useSignOut();
  const { currentOrg, currentOrgRole } = useAppStore();

  return (
    <header className="border-b bg-white">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-xl font-bold text-blue-600">
            Workflow Builder
          </Link>
          {currentOrg && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">Organization:</span>
              <span className="font-medium">{currentOrg.name}</span>
              <span className="px-2 py-0.5 bg-gray-100 rounded text-xs capitalize">
                {currentOrgRole}
              </span>
            </div>
          )}
        </div>
        
        {user && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <User className="w-4 h-4" />
              {user.email}
            </div>
            <Link 
              href="/settings" 
              className="p-2 hover:bg-gray-100 rounded"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </Link>
            <button
              onClick={() => signOut()}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
