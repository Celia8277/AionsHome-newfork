import { useAccountingStore, type TransactionType } from '../../stores/accounting';
import type { ToolDefinition, ToolModule } from './types';

const READ_TODAY: ToolDefinition = {
  type: 'function',
  function: {
    name: 'accounting_read_today',
    description: '读取用户今天的收入和支出流水、今日合计，以及当前可用的分类和付款方式。删除流水前应先调用此工具取得流水 ID。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

const ADD_RECORD: ToolDefinition = {
  type: 'function',
  function: {
    name: 'accounting_add_record',
    description: '为用户新增一条收入或支出流水。使用当前时间记账，并自动更新对应付款方式余额。',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['expense', 'income'], description: 'expense 表示支出，income 表示收入' },
        source: { type: 'string', description: '消费物品或收入来源' },
        amount: { type: 'number', description: '大于 0 的金额' },
        currency: { type: 'string', enum: ['CNY', 'USD', 'EUR', 'JPY', 'GBP'], description: '币种，必须与付款方式的币种一致' },
        category: { type: 'string', description: '分类名称或分类 ID。应优先使用 accounting_read_today 返回的可用值' },
        payment_method: { type: 'string', description: '付款方式名称或 ID。应优先使用 accounting_read_today 返回的可用值' },
      },
      required: ['type', 'source', 'amount', 'currency', 'category', 'payment_method'],
    },
  },
};

const DELETE_RECORD: ToolDefinition = {
  type: 'function',
  function: {
    name: 'accounting_delete_record',
    description: '按流水 ID 删除一条记账记录，并恢复对应付款方式余额。ID 必须来自 accounting_read_today 的结果。',
    parameters: {
      type: 'object',
      properties: { transaction_id: { type: 'string', description: '要删除的流水 ID' } },
      required: ['transaction_id'],
    },
  },
};

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function findByIdOrName<T extends { id: string; name: string }>(items: T[], value: unknown): T | undefined {
  const text = String(value || '').trim().toLowerCase();
  return items.find((item) => item.id.toLowerCase() === text || item.name.trim().toLowerCase() === text);
}

export const accountingTool: ToolModule = {
  id: 'accounting',
  labels: {
    accounting_read_today: '读取今日流水',
    accounting_add_record: '新增记账流水',
    accounting_delete_record: '删除记账流水',
  },
  getDefinitions: (config) => config.nativeTools?.accountingEnabled
    ? [READ_TODAY, ADD_RECORD, DELETE_RECORD]
    : [],
  execute: async (toolName, args, context) => {
    if (!toolName.startsWith('accounting_')) return undefined;
    if (!context.nativeToolConfig?.accountingEnabled) throw new Error('记账工具未开启');
    const store = useAccountingStore.getState();

    if (toolName === 'accounting_read_today') {
      const today = localDateKey(Date.now());
      const records = store.transactions
        .filter((item) => localDateKey(item.occurredAt) === today)
        .sort((a, b) => b.occurredAt - a.occurredAt)
        .map((item) => ({
          id: item.id,
          type: item.type,
          source: item.source,
          amount: item.amount,
          currency: item.currency,
          category: store.categories.find((entry) => entry.id === item.categoryId)?.name || item.categoryId,
          payment_method: store.paymentMethods.find((entry) => entry.id === item.paymentMethodId)?.name || item.paymentMethodId,
          time: new Date(item.occurredAt).toLocaleString('zh-CN', { hour12: false }),
        }));
      return JSON.stringify({
        date: today,
        totals_by_currency: Array.from(new Set(records.map((item) => item.currency))).map((currency) => ({
          currency,
          total_expense: records.filter((item) => item.currency === currency && item.type === 'expense').reduce((sum, item) => sum + item.amount, 0),
          total_income: records.filter((item) => item.currency === currency && item.type === 'income').reduce((sum, item) => sum + item.amount, 0),
        })),
        records,
        available_categories: store.categories.map((item) => ({ id: item.id, name: item.name, type: item.type })),
        available_payment_methods: store.paymentMethods.map((item) => ({ id: item.id, name: item.name, currency: item.currency })),
      });
    }

    if (toolName === 'accounting_add_record') {
      const type = args.type as TransactionType;
      const source = String(args.source || '').trim();
      const amount = Number(args.amount);
      const currency = String(args.currency || '').toUpperCase();
      if (type !== 'expense' && type !== 'income') throw new Error('type 必须是 expense 或 income');
      if (!source) throw new Error('缺少消费物品或收入来源');
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('金额必须是大于 0 的数字');
      const category = findByIdOrName(store.categories, args.category);
      if (!category || (category.type !== 'both' && category.type !== type)) throw new Error('分类不存在或不适用于该收支类型');
      const method = findByIdOrName(store.paymentMethods, args.payment_method);
      if (!method) throw new Error('付款方式不存在');
      if (method.currency !== currency) throw new Error('流水币种必须与付款方式币种一致');
      store.addTransaction({ type, source, amount, currency, categoryId: category.id, paymentMethodId: method.id, occurredAt: Date.now() });
      const created = useAccountingStore.getState().transactions[0];
      return JSON.stringify({ success: true, message: '流水已新增', transaction_id: created.id, type, source, amount, currency, category: category.name, payment_method: method.name });
    }

    if (toolName === 'accounting_delete_record') {
      const id = String(args.transaction_id || '').trim();
      const record = store.transactions.find((item) => item.id === id);
      if (!record) throw new Error('找不到指定流水');
      store.removeTransaction(id);
      return JSON.stringify({ success: true, message: '流水已删除', transaction_id: id, source: record.source, amount: record.amount });
    }

    return undefined;
  },
};
