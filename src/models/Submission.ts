import { Schema, model, Document, Types } from 'mongoose';

export interface ISubmission extends Document {
  userId: Types.ObjectId;
  problemId: Types.ObjectId;
  code: string;
  language: string;
  status: 'Pending' | 'Running' | 'Success' | 'RE' | 'TLE' | 'MLE' | 'WA' | 'Failed';
  results?: Array<{
    testcase: {
      _id: Types.ObjectId;
      input: string;
      output: string;
    };
    output: string;
    passed: boolean;
    error?: string;
  }>;
}

const submissionSchema = new Schema<ISubmission>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  problemId: { type: Schema.Types.ObjectId, ref: 'Problem', required: true },
  code: { type: String, required: true },
  language: { type: String, required: true },
  status: {
    type: String,
    enum: ['Pending', 'Running', 'Success', 'RE', 'TLE', 'MLE', 'WA', 'Failed'],
    default: 'Pending',
  },
  results: [{
    testcase: {
      _id: { type: Schema.Types.ObjectId, required: true },
      input: { type: String, required: true },
      output: { type: String, required: true }
    },
    output: { type: String, required: true },
    passed: { type: Boolean, required: true },
    error: { type: String }
  }]
});

export default model<ISubmission>('Submission', submissionSchema);
