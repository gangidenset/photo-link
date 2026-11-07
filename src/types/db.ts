// データベースの行の型 (supabase/migrations と対応)

export type Role = 'owner' | 'member';
export type MediaType = 'image' | 'video';

export interface Plan {
  id: string;
  name: string;
  max_albums: number;
  max_storage_bytes: number;
  max_image_bytes: number;
  max_video_bytes: number;
  max_video_duration_sec: number;
  features: Record<string, boolean>;
}

export interface Profile {
  id: string;
  display_name: string;
  avatar_path: string | null;
  plan_id: string;
  created_at: string;
  updated_at: string;
}

export type ProfileLite = Pick<Profile, 'id' | 'display_name' | 'avatar_path'>;

export interface Album {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  cover_photo_id: string | null;
  photo_count: number;
  member_count: number;
  last_photo_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AlbumWithCover extends Album {
  cover: Pick<Photo, 'id' | 'thumb_path' | 'preview_path'> | null;
}

export interface AlbumMember {
  album_id: string;
  user_id: string;
  role: Role;
  /** 招待リンクを作る権限 (オーナーが付与) */
  can_invite: boolean;
  joined_at: string;
  profile: ProfileLite | null;
}

export interface Invitation {
  id: string;
  album_id: string;
  created_by: string;
  token: string;
  code: string;
  requires_approval: boolean;
  expires_at: string;
  max_uses: number | null;
  use_count: number;
  revoked_at: string | null;
  created_at: string;
}

export interface JoinRequest {
  id: string;
  album_id: string;
  user_id: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  profile: ProfileLite | null;
}

export interface Photo {
  id: string;
  album_id: string;
  uploader_id: string;
  media_type: MediaType;
  status: 'uploading' | 'ready';
  storage_path: string;
  thumb_path: string | null;
  preview_path: string | null;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  original_filename: string;
  content_hash: string;
  /** 見た目の指紋 (端末の写真との照合用。古い写真は null) */
  phash: string | null;
  taken_at: string | null;
  sort_at: string;
  created_at: string;
  updated_at: string;
}

export interface PhotoWithUploader extends Photo {
  uploader: ProfileLite | null;
}

export interface Comment {
  id: string;
  photo_id: string;
  album_id: string;
  author_id: string;
  body: string;
  created_at: string;
  author: ProfileLite | null;
}

export interface Reaction {
  photo_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
  user: ProfileLite | null;
}

export type NotificationType =
  | 'photo_added'
  | 'member_joined'
  | 'comment'
  | 'reaction'
  | 'join_request'
  | 'join_approved'
  | 'join_rejected'
  | 'invite_permission_granted';

export interface AppNotification {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  album_id: string | null;
  photo_id: string | null;
  type: NotificationType;
  data: { count?: number; album_title?: string; excerpt?: string; emoji?: string; request_id?: string };
  read_at: string | null;
  created_at: string;
  actor: ProfileLite | null;
}

export interface InvitationPreview {
  album_id?: string;
  album_title?: string;
  member_count?: number;
  photo_count?: number;
  owner_name?: string;
  requires_approval?: boolean;
  expires_at?: string;
  state: 'valid' | 'already_member' | 'pending' | 'revoked' | 'expired' | 'used_up' | 'not_found';
}

export interface MyUsage {
  plan: Plan;
  storage_bytes: number;
  photo_count: number;
  album_count: number;
}

export const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '👏', '🎉', '👍', '🔥'] as const;
