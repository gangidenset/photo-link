// 有料プラン向け機能の利用可否
//   決済 (Stripe など) を導入するまでは全員に開放しておく。
//   有料化するときは OPEN_ALL_FEATURES を false にすると、plans.features の設定に従う。
import type { Plan } from '@/types/db';

export const OPEN_ALL_FEATURES = true;

export type FeatureKey = 'bulk_download' | 'advanced_search' | 'ads_free' | 'photobook';

export function hasFeature(plan: Plan | undefined | null, key: FeatureKey): boolean {
  return OPEN_ALL_FEATURES || Boolean(plan?.features?.[key]);
}
