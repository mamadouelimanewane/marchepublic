// Types générés par Supabase (placeholder avant exécution de `supabase gen types`)
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      institutions: {
        Row: {
          id: string
          code: string
          name: string
          type: string
          seuil_travaux: number
          seuil_fournitures: number
        }
      }
      users: {
        Row: {
          id: string
          institution_id: string | null
          role: string
          full_name: string
          email: string
        }
      }
      tenders: {
        Row: {
          id: string
          institution_id: string
          reference: string
          title: string
          current_phase: string
          montant_estime: number | null
          date_publication: string | null
          date_limite_depot: string | null
          mode_passation: string | null
          nature_marche: string
          is_alloti: boolean
        }
      }
      // ... autres tables simplifiées pour le typage initial
    }
  }
}
