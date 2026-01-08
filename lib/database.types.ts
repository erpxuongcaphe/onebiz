export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          entity_id: string | null
          entity_name: string | null
          entity_type: string
          id: string
          user_id: string
          user_name: string | null
          user_role: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type: string
          id?: string
          user_id: string
          user_name?: string | null
          user_role?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          entity_id?: string | null
          entity_name?: string | null
          entity_type?: string
          id?: string
          user_id?: string
          user_name?: string | null
          user_role?: string | null
        }
        Relationships: []
      }
      system_configs: {
        Row: {
          key: string
          value: Json
          description: string | null
          group_name: string | null
          created_at: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          key: string
          value: Json
          description?: string | null
          group_name?: string | null
          created_at?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          key?: string
          value?: Json
          description?: string | null
          group_name?: string | null
          created_at?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      attendance: {
        Row: {
          check_in: string | null
          check_out: string | null
          date: string | null
          id: string
          location_verified: boolean | null
          profile_id: string | null
        }
        Insert: {
          check_in?: string | null
          check_out?: string | null
          date?: string | null
          id?: string
          location_verified?: boolean | null
          profile_id?: string | null
        }
        Update: {
          check_in?: string | null
          check_out?: string | null
          date?: string | null
          id?: string
          location_verified?: boolean | null
          profile_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_permissions: {
        Row: {
          assigned_by: string | null
          branch_id: string | null
          can_check_attendance: boolean | null
          created_at: string | null
          id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          branch_id?: string | null
          can_check_attendance?: boolean | null
          created_at?: string | null
          id?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          branch_id?: string | null
          can_check_attendance?: boolean | null
          created_at?: string | null
          id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_permissions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          branch_id: string | null
          check_in: string | null
          check_out: string | null
          checked_by: string | null
          created_at: string | null
          date: string
          employee_id: string
          hours_worked: number | null
          id: string
          notes: string | null
          overtime_hours: number | null
          schedule_id: string | null
          shift_id: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          branch_id?: string | null
          check_in?: string | null
          check_out?: string | null
          checked_by?: string | null
          created_at?: string | null
          date: string
          employee_id: string
          hours_worked?: number | null
          id?: string
          notes?: string | null
          overtime_hours?: number | null
          schedule_id?: string | null
          shift_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          branch_id?: string | null
          check_in?: string | null
          check_out?: string | null
          checked_by?: string | null
          created_at?: string | null
          date?: string
          employee_id?: string
          hours_worked?: number | null
          id?: string
          notes?: string | null
          overtime_hours?: number | null
          schedule_id?: string | null
          shift_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "work_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          is_office: boolean | null
          latitude: number | null
          longitude: number | null
          name: string
          qr_token: string | null
          radius: number | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_office?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name: string
          qr_token?: string | null
          radius?: number | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_office?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name?: string
          qr_token?: string | null
          radius?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      departments: {
        Row: {
          career_path: Json | null
          id: string
          name: string
        }
        Insert: {
          career_path?: Json | null
          id?: string
          name: string
        }
        Update: {
          career_path?: Json | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      employee_documents: {
        Row: {
          created_at: string | null
          description: string | null
          document_type: string
          employee_id: string
          expiry_date: string | null
          file_size: number | null
          file_type: string | null
          file_url: string
          id: string
          is_verified: boolean | null
          issue_date: string | null
          name: string
          updated_at: string | null
          uploaded_by: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          document_type: string
          employee_id: string
          expiry_date?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url: string
          id?: string
          is_verified?: boolean | null
          issue_date?: string | null
          name: string
          updated_at?: string | null
          uploaded_by?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          document_type?: string
          employee_id?: string
          expiry_date?: string | null
          file_size?: number | null
          file_type?: string | null
          file_url?: string
          id?: string
          is_verified?: boolean | null
          issue_date?: string | null
          name?: string
          updated_at?: string | null
          uploaded_by?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_documents_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_history: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string
          employee_id: string
          event_date: string
          event_type: string
          id: string
          metadata: Json | null
          new_value: string | null
          old_value: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description: string
          employee_id: string
          event_date: string
          event_type: string
          id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string
          employee_id?: string
          event_date?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          new_value?: string | null
          old_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_history_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_history_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          address: string | null
          address_city: string | null
          address_district: string | null
          address_street: string | null
          address_ward: string | null
          avatar: string | null
          branch_id: string | null
          created_at: string | null
          date_of_birth: string | null
          department: string
          email: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          employee_type: string | null
          employment_type: string | null
          gender: string | null
          hourly_rate: number | null
          id: string
          identity_card: string | null
          join_date: string
          kpi_target: number | null
          lunch_allowance: number | null
          name: string
          notes: string | null
          other_allowance: number | null
          pay_type: string | null
          phone: string | null
          phone_allowance: number | null
          position: string
          salary: number | null
          status: string
          termination_date: string | null
          transport_allowance: number | null
          uniform_cost: number | null
          uniform_expiry_date: string | null
          uniform_issue_date: string | null
          updated_at: string | null
          tax_id: string | null
          social_insurance_id: string | null
          department_id: string | null // Added
          position_id: string | null // Added
        }
        Insert: {
          address?: string | null
          address_city?: string | null
          address_district?: string | null
          address_street?: string | null
          address_ward?: string | null
          avatar?: string | null
          branch_id?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          department: string
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_type?: string | null
          employment_type?: string | null
          gender?: string | null
          hourly_rate?: number | null
          id: string
          identity_card?: string | null
          join_date: string
          kpi_target?: number | null
          lunch_allowance?: number | null
          name: string
          notes?: string | null
          other_allowance?: number | null
          pay_type?: string | null
          phone?: string | null
          phone_allowance?: number | null
          position: string
          salary?: number | null
          status?: string
          termination_date?: string | null
          transport_allowance?: number | null
          uniform_cost?: number | null
          uniform_expiry_date?: string | null
          uniform_issue_date?: string | null
          updated_at?: string | null
          tax_id?: string | null
          social_insurance_id?: string | null
          department_id?: string | null
          position_id?: string | null
        }
        Update: {
          address?: string | null
          address_city?: string | null
          address_district?: string | null
          address_street?: string | null
          address_ward?: string | null
          avatar?: string | null
          branch_id?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          department?: string
          email?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_type?: string | null
          employment_type?: string | null
          gender?: string | null
          hourly_rate?: number | null
          id?: string
          identity_card?: string | null
          join_date?: string
          kpi_target?: number | null
          lunch_allowance?: number | null
          name?: string
          notes?: string | null
          other_allowance?: number | null
          pay_type?: string | null
          phone?: string | null
          phone_allowance?: number | null
          position?: string
          salary?: number | null
          status?: string
          termination_date?: string | null
          transport_allowance?: number | null
          uniform_cost?: number | null
          uniform_expiry_date?: string | null
          uniform_issue_date?: string | null
          updated_at?: string | null
          tax_id?: string | null
          social_insurance_id?: string | null
          department_id?: string | null
          position_id?: string | null
        }
        Relationships: []
      }
      holidays: {
        Row: {
          created_at: string | null
          date: string
          id: string
          is_recurring: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          date: string
          id?: string
          is_recurring?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          date?: string
          id?: string
          is_recurring?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      leave_balances: {
        Row: {
          created_at: string | null
          employee_id: string
          id: string
          leave_type_id: string
          pending_days: number
          total_days: number
          updated_at: string | null
          used_days: number
          year: number
        }
        Insert: {
          created_at?: string | null
          employee_id: string
          id?: string
          leave_type_id: string
          pending_days?: number
          total_days?: number
          updated_at?: string | null
          used_days?: number
          year?: number
        }
        Update: {
          created_at?: string | null
          employee_id?: string
          id?: string
          leave_type_id?: string
          pending_days?: number
          total_days?: number
          updated_at?: string | null
          used_days?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_balances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_balances_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          created_at: string | null
          employee_id: string
          end_date: string
          half_day_period: string | null
          id: string
          is_half_day: boolean | null
          leave_type_id: string
          reason: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          start_date: string
          status: string | null
          total_days: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          employee_id: string
          end_date: string
          half_day_period?: string | null
          id?: string
          is_half_day?: boolean | null
          leave_type_id: string
          reason?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date: string
          status?: string | null
          total_days: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          employee_id?: string
          end_date?: string
          half_day_period?: string | null
          id?: string
          is_half_day?: boolean | null
          leave_type_id?: string
          reason?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string
          status?: string | null
          total_days?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_types: {
        Row: {
          color: string | null
          created_at: string | null
          default_days_per_year: number | null
          description: string | null
          id: string
          is_active: boolean | null
          is_paid: boolean | null
          name: string
          requires_approval: boolean | null
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          default_days_per_year?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_paid?: boolean | null
          name: string
          requires_approval?: boolean | null
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          default_days_per_year?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_paid?: boolean | null
          name?: string
          requires_approval?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      monthly_salaries: {
        Row: {
          base_salary: number | null
          bonus: number | null
          bonus_note: string | null
          branch_id: string | null
          created_at: string | null
          early_leave_count: number | null
          employee_id: string
          finalized_at: string | null
          finalized_by: string | null
          gross_salary: number | null
          hourly_rate: number | null
          hours_worked: number | null
          id: string
          insurance_deduction: number | null
          is_finalized: boolean | null
          kpi_percent: number | null
          kpi_target: number | null
          kpi_bonus: number | null // Added
          late_count: number | null
          lunch_allowance: number | null
          month: string
          net_salary: number | null
          notes: string | null
          ot_hours: number | null
          other_allowance: number | null
          payslip_number: string | null // Added
          exported_count: number | null // Added
          last_exported_at: string | null // Added
          finalized_by_name: string | null // Added
          penalty: number | null
          phone_allowance: number | null
          pit_deduction: number | null
          regular_hours: number | null
          transport_allowance: number | null
          updated_at: string | null
          work_days: number | null
        }
        Insert: {
          base_salary?: number | null
          bonus?: number | null
          bonus_note?: string | null
          branch_id?: string | null
          created_at?: string | null
          early_leave_count?: number | null
          employee_id: string
          finalized_at?: string | null
          finalized_by?: string | null
          gross_salary?: number | null
          hourly_rate?: number | null
          hours_worked?: number | null
          id?: string
          insurance_deduction?: number | null
          is_finalized?: boolean | null
          kpi_percent?: number | null
          kpi_target?: number | null
          kpi_bonus?: number | null // Added
          late_count?: number | null
          lunch_allowance?: number | null
          month: string
          net_salary?: number | null
          notes?: string | null
          ot_hours?: number | null
          other_allowance?: number | null
          penalty?: number | null
          phone_allowance?: number | null
          pit_deduction?: number | null
          regular_hours?: number | null
          transport_allowance?: number | null
          updated_at?: string | null
          work_days?: number | null
        }
        Update: {
          base_salary?: number | null
          bonus?: number | null
          bonus_note?: string | null
          branch_id?: string | null
          created_at?: string | null
          early_leave_count?: number | null
          employee_id?: string
          finalized_at?: string | null
          finalized_by?: string | null
          gross_salary?: number | null
          hourly_rate?: number | null
          hours_worked?: number | null
          id?: string
          insurance_deduction?: number | null
          is_finalized?: boolean | null
          kpi_percent?: number | null
          kpi_target?: number | null
          kpi_bonus?: number | null // Added
          late_count?: number | null
          lunch_allowance?: number | null
          month?: string
          net_salary?: number | null
          notes?: string | null
          ot_hours?: number | null
          other_allowance?: number | null
          penalty?: number | null
          phone_allowance?: number | null
          pit_deduction?: number | null
          regular_hours?: number | null
          transport_allowance?: number | null
          updated_at?: string | null
          work_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_salaries_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_salaries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_settings: {
        Row: {
          attendance_reminders: boolean | null
          birthday_notifications: boolean | null
          contract_expiry_notifications: boolean | null
          created_at: string | null
          id: string
          leave_notifications: boolean | null
          salary_notifications: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          attendance_reminders?: boolean | null
          birthday_notifications?: boolean | null
          contract_expiry_notifications?: boolean | null
          created_at?: string | null
          id?: string
          leave_notifications?: boolean | null
          salary_notifications?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          attendance_reminders?: boolean | null
          birthday_notifications?: boolean | null
          contract_expiry_notifications?: boolean | null
          created_at?: string | null
          id?: string
          leave_notifications?: boolean | null
          salary_notifications?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          is_read: boolean | null
          link: string | null
          message: string
          metadata: Json | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          message: string
          metadata?: Json | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          message?: string
          metadata?: Json | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payslip_templates: {
        Row: {
          branch_id: string | null
          company_address: string | null
          company_email: string | null
          company_name: string
          company_phone: string | null
          company_tax_code: string | null
          created_at: string | null
          footer_text: string | null
          header_text: string | null
          id: string
          is_default: boolean | null
          logo_url: string | null
          updated_at: string | null
        }
        Insert: {
          branch_id?: string | null
          company_address?: string | null
          company_email?: string | null
          company_name: string
          company_phone?: string | null
          company_tax_code?: string | null
          created_at?: string | null
          footer_text?: string | null
          header_text?: string | null
          id?: string
          is_default?: boolean | null
          logo_url?: string | null
          updated_at?: string | null
        }
        Update: {
          branch_id?: string | null
          company_address?: string | null
          company_email?: string | null
          company_name?: string
          company_phone?: string | null
          company_tax_code?: string | null
          created_at?: string | null
          footer_text?: string | null
          header_text?: string | null
          id?: string
          is_default?: boolean | null
          logo_url?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payslip_templates_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_reviews: {
        Row: {
          created_at: string | null
          cycle_id: string
          employee_id: string
          goals: string | null
          id: string
          improvements: string | null
          manager_comments: string | null
          overall_rating: string | null
          overall_score: number | null
          review_type: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          status: string | null
          strengths: string | null
          submitted_at: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          cycle_id: string
          employee_id: string
          goals?: string | null
          id?: string
          improvements?: string | null
          manager_comments?: string | null
          overall_rating?: string | null
          overall_score?: number | null
          review_type?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: string | null
          strengths?: string | null
          submitted_at?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          cycle_id?: string
          employee_id?: string
          goals?: string | null
          id?: string
          improvements?: string | null
          manager_comments?: string | null
          overall_rating?: string | null
          overall_score?: number | null
          review_type?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: string | null
          strengths?: string | null
          submitted_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "performance_reviews_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "review_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_reviews_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions_template: {
        Row: {
          created_at: string | null
          id: string
          permission_code: string
          role: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          permission_code: string
          role: string
        }
        Update: {
          created_at?: string | null
          id?: string
          permission_code?: string
          role?: string
        }
        Relationships: []
      }
      positions: {
        Row: {
          created_at: string | null
          department_id: string | null
          description: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          department_id?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          department_id?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "positions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          current_level: string | null
          department_id: string | null
          email: string
          full_name: string
          id: string
          join_date: string | null
          status: string | null
        }
        Insert: {
          avatar_url?: string | null
          current_level?: string | null
          department_id?: string | null
          email: string
          full_name: string
          id?: string
          join_date?: string | null
          status?: string | null
        }
        Update: {
          avatar_url?: string | null
          current_level?: string | null
          department_id?: string | null
          email?: string
          full_name?: string
          id?: string
          join_date?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      registration_settings: {
        Row: {
          branch_id: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          is_closed: boolean | null
          registration_end_day: number | null
          registration_end_hour: number | null
          registration_start_day: number | null
          registration_start_hour: number | null
          updated_at: string | null
          weeks_ahead: number | null
        }
        Insert: {
          branch_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_closed?: boolean | null
          registration_end_day?: number | null
          registration_end_hour?: number | null
          registration_start_day?: number | null
          registration_start_hour?: number | null
          updated_at?: string | null
          weeks_ahead?: number | null
        }
        Update: {
          branch_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_closed?: boolean | null
          registration_end_day?: number | null
          registration_end_hour?: number | null
          registration_start_day?: number | null
          registration_start_hour?: number | null
          updated_at?: string | null
          weeks_ahead?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "registration_settings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      review_criteria: {
        Row: {
          category: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          max_score: number | null
          name: string
          weight: number | null
        }
        Insert: {
          category: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          max_score?: number | null
          name: string
          weight?: number | null
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          max_score?: number | null
          name?: string
          weight?: number | null
        }
        Relationships: []
      }
      review_cycles: {
        Row: {
          created_at: string | null
          created_by: string | null
          cycle_type: string | null
          description: string | null
          end_date: string
          id: string
          name: string
          review_deadline: string
          start_date: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          cycle_type?: string | null
          description?: string | null
          end_date: string
          id?: string
          name: string
          review_deadline: string
          start_date: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          cycle_type?: string | null
          description?: string | null
          end_date?: string
          id?: string
          name?: string
          review_deadline?: string
          start_date?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "review_cycles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      review_scores: {
        Row: {
          comment: string | null
          created_at: string | null
          criteria_id: string
          id: string
          review_id: string
          score: number | null
        }
        Insert: {
          comment?: string | null
          created_at?: string | null
          criteria_id: string
          id?: string
          review_id: string
          score?: number | null
        }
        Update: {
          comment?: string | null
          created_at?: string | null
          criteria_id?: string
          id?: string
          review_id?: string
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "review_scores_criteria_id_fkey"
            columns: ["criteria_id"]
            isOneToOne: false
            referencedRelation: "review_criteria"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_scores_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "performance_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      salary_configs: {
        Row: {
          config_key: string
          config_value: string | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          pay_type: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          config_key: string
          config_value?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          pay_type: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          config_key?: string
          config_value?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          pay_type?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      shift_registrations: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          branch_id: string
          created_at: string | null
          employee_id: string
          id: string
          notes: string | null
          registered_at: string | null
          shift_date: string
          shift_id: string | null
          status: string | null
          week_start: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          branch_id: string
          created_at?: string | null
          employee_id: string
          id?: string
          notes?: string | null
          registered_at?: string | null
          shift_date: string
          shift_id?: string | null
          status?: string | null
          week_start: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          branch_id?: string
          created_at?: string | null
          employee_id?: string
          id?: string
          notes?: string | null
          registered_at?: string | null
          shift_date?: string
          shift_id?: string | null
          status?: string | null
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_registrations_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_registrations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_registrations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_registrations_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          branch_id: string | null
          created_at: string | null
          end_time: string
          hourly_rate: number | null
          id: string
          is_active: boolean | null
          name: string
          start_time: string
          updated_at: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string | null
          end_time: string
          hourly_rate?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          start_time: string
          updated_at?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string | null
          end_time?: string
          hourly_rate?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          start_time?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          granted: boolean | null
          id: string
          permission_code: string
          user_id: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          granted?: boolean | null
          id?: string
          permission_code: string
          user_id: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          granted?: boolean | null
          id?: string
          permission_code?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permissions_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string | null
          email: string
          employee_id: string | null
          full_name: string
          id: string
          is_active: boolean
          password_hash: string
          role: string
          username: string
        }
        Insert: {
          created_at?: string | null
          email: string
          employee_id?: string | null
          full_name: string
          id: string
          is_active?: boolean
          password_hash: string
          role?: string
          username: string
        }
        Update: {
          created_at?: string | null
          email?: string
          employee_id?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          password_hash?: string
          role?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      work_hour_requirements: {
        Row: {
          created_at: string | null
          description: string | null
          employment_type: string
          id: string
          min_hours_per_month: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          employment_type: string
          id?: string
          min_hours_per_month: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          employment_type?: string
          id?: string
          min_hours_per_month?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      work_schedules: {
        Row: {
          branch_id: string | null
          created_at: string | null
          created_by: string | null
          custom_end: string | null
          custom_start: string | null
          date: string
          employee_id: string
          id: string
          notes: string | null
          shift_id: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string | null
          created_by?: string | null
          custom_end?: string | null
          custom_start?: string | null
          date: string
          employee_id: string
          id?: string
          notes?: string | null
          shift_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string | null
          created_by?: string | null
          custom_end?: string | null
          custom_start?: string | null
          date?: string
          employee_id?: string
          id?: string
          notes?: string | null
          shift_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_schedules_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_schedules_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      payroll_history_view: {
        Row: {
          month: string | null
          branch_id: string | null
          branch_name: string | null
          total_employees: number | null
          total_gross_salary: number | null
          total_net_salary: number | null
          total_insurance_deduction: number | null
          total_pit_deduction: number | null
          avg_net_salary: number | null
          finalized_count: number | null
          first_finalized_at: string | null
          last_finalized_at: string | null
          total_exports: number | null
        }
        Relationships: []
      },
      employee_salary_history_view: {
        Row: {
          employee_id: string | null
          employee_name: string | null
          department: string | null
          position: string | null
          month: string | null
          payslip_number: string | null
          base_salary: number | null
          work_days: number | null
          ot_hours: number | null
          gross_salary: number | null
          insurance_deduction: number | null
          pit_deduction: number | null
          net_salary: number | null
          is_finalized: boolean | null
          finalized_at: string | null
          finalized_by_name: string | null
          exported_count: number | null
          last_exported_at: string | null
          created_at: string | null
          updated_at: string | null
        }
        Relationships: []
      },
      notification_unread_counts: {
        Row: {
          unread_count: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      calculate_review_rating: { Args: { p_score: number }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
  | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
    DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
    DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
  ? R
  : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
    DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] &
    DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
  ? R
  : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
  | keyof DefaultSchema["Tables"]
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Insert: infer I
  }
  ? I
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
    Insert: infer I
  }
  ? I
  : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
  | keyof DefaultSchema["Tables"]
  | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
  : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
    Update: infer U
  }
  ? U
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
    Update: infer U
  }
  ? U
  : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
  | keyof DefaultSchema["Enums"]
  | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
  : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
  | keyof DefaultSchema["CompositeTypes"]
  | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
  ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
  : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const


export type Employee = Database['public']['Tables']['employees']['Row'];

export type UserRole = 'admin' | 'branch_manager' | 'accountant' | 'member';

export type EmployeeInsert = Database['public']['Tables']['employees']['Insert'];
export type EmployeeUpdate = Database['public']['Tables']['employees']['Update'];

export type DbUser = Database['public']['Tables']['users']['Row'];
export type DbUserInsert = Database['public']['Tables']['users']['Insert'];
export type DbUserUpdate = Database['public']['Tables']['users']['Update'];
