import type { InjectionKey, ComputedRef } from 'vue';
import type { Role } from '@/types/review';

// Which role the tour is playing as, for the scenes' header (see TourStage).
export const TOUR_ROLE: InjectionKey<ComputedRef<Role>> = Symbol('tour-role');
