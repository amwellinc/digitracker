export const CURRENCIES = ['SGD', 'MYR', 'PHP', 'USD', 'GBP', 'AUD', 'INR', 'AED', 'IDR', 'THB', 'VND', 'CNY', 'JPY']

export function fmtAmount(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
}

export interface PayrollSettings {
  id: string
  user_id: string
  currency: string

  gross_salary: number
  gross_salary_desc: string

  overtime_enabled: boolean
  overtime_amount: number
  overtime_desc: string

  incentive_enabled: boolean
  incentive_amount: number
  incentive_desc: string

  commission_enabled: boolean
  commission_amount: number
  commission_desc: string

  cpf_enabled: boolean
  cpf_amount: number
  cpf_desc: string

  insurance_enabled: boolean
  insurance_amount: number
  insurance_desc: string

  other_deduction_enabled: boolean
  other_deduction_amount: number
  other_deduction_desc: string

  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface PayrollRun {
  id: string
  user_id: string
  payment_date: string
  currency: string

  gross_salary: number
  gross_salary_desc: string

  overtime_amount: number
  overtime_desc: string

  incentive_amount: number
  incentive_desc: string

  commission_amount: number
  commission_desc: string

  cpf_amount: number
  cpf_desc: string

  insurance_amount: number
  insurance_desc: string

  other_deduction_amount: number
  other_deduction_desc: string

  net_pay: number

  created_by: string | null
  created_at: string
  updated_at: string
  user?: { name: string; email: string }
}

export function computeNetPay(v: {
  gross_salary: number
  overtime_amount: number
  incentive_amount: number
  commission_amount: number
  cpf_amount: number
  insurance_amount: number
  other_deduction_amount: number
}): number {
  return v.gross_salary + v.overtime_amount + v.incentive_amount + v.commission_amount
    - v.cpf_amount - v.insurance_amount - v.other_deduction_amount
}

export const emptyPayrollSettings = (userId: string): Omit<PayrollSettings, 'id' | 'created_at' | 'updated_at'> => ({
  user_id: userId,
  currency: 'SGD',
  gross_salary: 0,
  gross_salary_desc: '',
  overtime_enabled: false,
  overtime_amount: 0,
  overtime_desc: '',
  incentive_enabled: false,
  incentive_amount: 0,
  incentive_desc: '',
  commission_enabled: false,
  commission_amount: 0,
  commission_desc: '',
  cpf_enabled: false,
  cpf_amount: 0,
  cpf_desc: '',
  insurance_enabled: false,
  insurance_amount: 0,
  insurance_desc: '',
  other_deduction_enabled: false,
  other_deduction_amount: 0,
  other_deduction_desc: '',
  updated_by: null,
})
