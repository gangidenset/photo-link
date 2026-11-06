import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { isSupabaseConfigured } from '@/lib/supabase';
import { AuthProvider, RequireAuth } from '@/features/auth/AuthProvider';
import {
  AuthCallbackPage,
  AuthConfirmPage,
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
  SignupPage,
} from '@/features/auth/AuthPages';
import { AppLayout } from '@/components/AppLayout';
import { FullPageSpinner } from '@/components/ui';
import { Toaster } from '@/components/toast';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import { SetupRequired } from '@/components/SetupRequired';
import { HomePage } from '@/features/home/HomePage';
import { AlbumDetailPage, AlbumFormPage, AlbumsPage } from '@/features/albums/AlbumPages';

// 初回表示を軽くするため、使用頻度の低い画面は必要になった時に読み込む
const PhotoViewerPage = lazy(() => import('@/features/photos/PhotoViewerPage').then((m) => ({ default: m.PhotoViewerPage })));
const UploadPickerPage = lazy(() => import('@/features/upload/UploadPages').then((m) => ({ default: m.UploadPickerPage })));
const UploadsPage = lazy(() => import('@/features/upload/UploadPages').then((m) => ({ default: m.UploadsPage })));
const MembersPage = lazy(() => import('@/features/members/MemberPages').then((m) => ({ default: m.MembersPage })));
const InvitePage = lazy(() => import('@/features/members/MemberPages').then((m) => ({ default: m.InvitePage })));
const JoinPage = lazy(() => import('@/features/members/MemberPages').then((m) => ({ default: m.JoinPage })));
const NotificationsPage = lazy(() => import('@/features/notifications/NotificationsPage').then((m) => ({ default: m.NotificationsPage })));
const ProfilePage = lazy(() => import('@/features/profile/ProfilePages').then((m) => ({ default: m.ProfilePage })));
const SettingsPage = lazy(() => import('@/features/profile/ProfilePages').then((m) => ({ default: m.SettingsPage })));
const TermsPage = lazy(() => import('@/features/legal/LegalPages').then((m) => ({ default: m.TermsPage })));
const PrivacyPage = lazy(() => import('@/features/legal/LegalPages').then((m) => ({ default: m.PrivacyPage })));

export function App() {
  if (!isSupabaseConfigured) return <SetupRequired />;
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<FullPageSpinner />}>
            <Routes>
              {/* 未ログインでも開ける画面 */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/auth/confirm" element={<AuthConfirmPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />

              {/* 写真ビューアは全画面 (下部ナビなし) */}
              <Route
                path="/albums/:albumId/photos/:photoId"
                element={
                  <RequireAuth>
                    <PhotoViewerPage />
                  </RequireAuth>
                }
              />

              {/* ログイン必須 + 下部ナビ */}
              <Route
                element={
                  <RequireAuth>
                    <AppLayout />
                  </RequireAuth>
                }
              >
                <Route index element={<HomePage />} />
                <Route path="/albums" element={<AlbumsPage />} />
                <Route path="/albums/new" element={<AlbumFormPage />} />
                <Route path="/albums/:albumId" element={<AlbumDetailPage />} />
                <Route path="/albums/:albumId/edit" element={<AlbumFormPage />} />
                <Route path="/albums/:albumId/upload" element={<UploadPickerPage />} />
                <Route path="/albums/:albumId/members" element={<MembersPage />} />
                <Route path="/albums/:albumId/invite" element={<InvitePage />} />
                <Route path="/uploads" element={<UploadsPage />} />
                <Route path="/join" element={<JoinPage />} />
                <Route path="/join/:token" element={<JoinPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
          <Toaster />
          <UpdatePrompt />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
