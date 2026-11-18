import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ImagePlus, Sparkles } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { PriceEstimateCard } from '../../components/PriceEstimateCard';
import { apiRequest } from '../../lib/api';
import {
  CATEGORY_NAMES,
  SUPPORTED_CITIES,
  URGENCY_LEVELS,
  type UrgencyLevel,
} from '../../../shared/constants';
import type {
  Job,
  PriceEstimateResult,
  UnderstandJobResult,
  ValidateJobResult,
} from '../../types/bookam';

export function PostJobPage() {
  const navigate = useNavigate();

  // Initial customer input
  const [description, setDescription] = useState('');
  const [locationInput, setLocationInput] = useState('Ugbowo');
  const [budgetInput, setBudgetInput] = useState('');
  const [urgencyInput, setUrgencyInput] = useState<UrgencyLevel>('Medium');
  const [referenceImageUrl, setReferenceImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);

  // AI & Review Step state
  const [analyzing, setAnalyzing] = useState(false);
  const [reviewReady, setReviewReady] = useState(false);
  const [validationNotice, setValidationNotice] = useState<ValidateJobResult | null>(null);
  const [estimate, setEstimate] = useState<PriceEstimateResult | null>(null);
  const [skipEstimate, setSkipEstimate] = useState(false);

  // Editable confirmed fields
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(CATEGORY_NAMES[0]);
  const [location, setLocation] = useState('Ugbowo');
  const [urgency, setUrgency] = useState<UrgencyLevel>('Medium');
  const [budget, setBudget] = useState('');
  const [additionalQuestions, setAdditionalQuestions] = useState<string[]>([]);
  const [confirmedAccurate, setConfirmedAccurate] = useState(false);

  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setError('Reference image must be 3MB or smaller.');
      return;
    }

    setError('');
    setUploadingImage(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Failed to read image file.'));
        reader.readAsDataURL(file);
      });

      const res = await apiRequest<{ url: string }>('/api/uploads', {
        method: 'POST',
        body: JSON.stringify({ dataUrl, folder: 'jobs', fileName: file.name }),
      });
      setReferenceImageUrl(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload reference image.');
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setValidationNotice(null);
    setAnalyzing(true);

    try {
      const data = await apiRequest<{
        validation: ValidateJobResult;
        understood: UnderstandJobResult | null;
        estimate: PriceEstimateResult | null;
      }>('/api/ai/analyze-request', {
        method: 'POST',
        body: JSON.stringify({ description }),
      });

      setValidationNotice(data.validation);

      if (data.validation.valid && data.understood) {
        setTitle(data.understood.title);
        setCategory(data.understood.category);
        setLocation(data.understood.location || locationInput);
        setUrgency(data.understood.urgency || urgencyInput);
        if (!budgetInput && data.understood.detectedBudget) {
          setBudget(String(data.understood.detectedBudget));
        } else {
          setBudget(budgetInput);
        }
        setAdditionalQuestions(data.understood.additionalQuestions || []);
        setEstimate(data.estimate);
        setSkipEstimate(false);
        setReviewReady(true);
        setConfirmedAccurate(false);
      } else {
        // Invalid, gibberish, or AI unavailable -> prepare manual creation fallback cleanly
        setEstimate(null);
      }
    } catch (err) {
      setValidationNotice({
        valid: false,
        status: 'ai_unavailable',
        message:
          "We couldn't confidently understand this request right now. Please provide more details or select a service category manually.",
        suggestions: ['Switch to manual entry below to select a category and publish.'],
        allowManual: true,
      });
      setError(err instanceof Error ? err.message : '');
    } finally {
      setAnalyzing(false);
    }
  }

  function enterManualMode() {
    setReviewReady(true);
    setTitle(description.trim().slice(0, 60) || 'Service Request');
    setCategory(CATEGORY_NAMES[0]);
    setLocation(locationInput);
    setUrgency(urgencyInput);
    setBudget(budgetInput);
    setAdditionalQuestions([]);
    setEstimate(null);
    setSkipEstimate(true);
    setConfirmedAccurate(false);
  }

  async function handleRefreshEstimate() {
    setError('');
    try {
      const res = await apiRequest<{ estimate: PriceEstimateResult }>('/api/ai/estimate', {
        method: 'POST',
        body: JSON.stringify({
          category,
          title: title || 'Service request',
          description,
          location,
          urgency,
        }),
      });
      setEstimate(res.estimate);
      setSkipEstimate(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate estimate.');
    }
  }

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmedAccurate) {
      setError('Please confirm that your job details are accurate before publishing.');
      return;
    }

    setError('');
    setPublishing(true);
    try {
      const parsedBudget = budget.trim() ? Math.round(Number(budget)) : null;
      const activeEstimate = skipEstimate ? null : estimate;

      const res = await apiRequest<{ job: Job }>('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category,
          city: 'Benin City',
          location: location.trim(),
          budget: parsedBudget && parsedBudget > 0 ? parsedBudget : null,
          estimated_min: activeEstimate ? activeEstimate.estimatedMin : null,
          estimated_max: activeEstimate ? activeEstimate.estimatedMax : null,
          suggested_deposit: activeEstimate ? activeEstimate.suggestedDeposit : null,
          estimate_explanation: activeEstimate ? activeEstimate.explanation : '',
          estimate_assumptions: activeEstimate ? activeEstimate.assumptions : [],
          estimate_is_provisional: activeEstimate ? activeEstimate.isProvisional : true,
          urgency,
          reference_image_url: referenceImageUrl,
          additional_questions: additionalQuestions,
        }),
      });

      navigate(`/customer/jobs/${res.job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to publish job.');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <AppShell mode="customer" title="Post a Job">
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1A1B25]">Post a service request</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            Describe what you need in plain language. BookAm Intelligence will extract the details for your review and confirmation before publishing.
          </p>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-[#FF3B30]">
            {error}
          </div>
        )}

        {/* Step 1: Problem Description */}
        <form
          onSubmit={handleAnalyze}
          className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5"
        >
          <div>
            <label htmlFor="job-description" className="block text-sm font-semibold text-[#1A1B25] mb-1.5">
              Describe your problem
            </label>
            <textarea
              id="job-description"
              rows={4}
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder='Example: "I need a plumber in Ugbowo. My kitchen pipe is leaking badly and I need someone tomorrow. My budget is ₦10,000."'
              className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#635BFF]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
                Neighborhood (Benin City)
              </label>
              <input
                list="benin-areas"
                value={locationInput}
                onChange={(e) => setLocationInput(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#635BFF]"
                placeholder="Ugbowo, GRA, Ring Road..."
              />
              <datalist id="benin-areas">
                {SUPPORTED_CITIES[0].areas.map((area) => (
                  <option key={area} value={area} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
                Optional budget (₦)
              </label>
              <input
                type="number"
                min={500}
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono-nums focus:outline-none focus:ring-2 focus:ring-[#635BFF]"
                placeholder="e.g. 10000"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
                Urgency
              </label>
              <select
                value={urgencyInput}
                onChange={(e) => setUrgencyInput(e.target.value as UrgencyLevel)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#635BFF]"
              >
                {URGENCY_LEVELS.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Optional Reference Image Upload */}
          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-[#635BFF] hover:text-[#4A44C6] cursor-pointer">
              <ImagePlus className="w-4 h-4" />
              <span>
                {uploadingImage
                  ? 'Uploading image...'
                  : referenceImageUrl
                    ? 'Reference image uploaded (click to replace)'
                    : 'Attach optional reference image'}
              </span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleImageUpload}
                className="hidden"
              />
            </label>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={enterManualMode}
                className="text-xs font-semibold text-[#6B7280] hover:text-[#1A1B25]"
              >
                Fill details manually
              </button>
              <button
                type="submit"
                disabled={analyzing}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] disabled:opacity-60 text-white text-sm font-semibold transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                {analyzing ? 'Analyzing...' : 'Analyze Request'}
              </button>
            </div>
          </div>
        </form>

        {/* AI Validation Warning / Manual Fallback */}
        {validationNotice && !validationNotice.valid && (
          <div className="bg-white rounded-2xl border border-[#FF6B35]/50 p-5 space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-[#FF6B35] shrink-0 mt-0.5" />
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-[#1A1B25]">
                  More detail needed ({validationNotice.status.replace('_', ' ')})
                </h3>
                <p className="text-sm text-[#6B7280]">{validationNotice.message}</p>
                {validationNotice.suggestions.length > 0 && (
                  <ul className="text-xs text-[#6B7280] list-disc list-inside space-y-1">
                    {validationNotice.suggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}
                {validationNotice.allowManual && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={enterManualMode}
                      className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-[#F6F7FB] text-xs font-semibold text-[#1A1B25]"
                    >
                      Select service category manually
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Review, Edit, and Explicitly Confirm before Publication */}
        {reviewReady && (
          <form
            onSubmit={handlePublish}
            className="bg-white rounded-2xl border border-slate-200 p-6 space-y-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-lg font-bold text-[#1A1B25]">
                  Review & confirm job details
                </h2>
                <p className="text-xs text-[#6B7280] mt-0.5">
                  Edit any extracted field below before publishing to local workers.
                </p>
              </div>
              <CheckCircle2 className="w-5 h-5 text-[#00C853]" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
                  Job title
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#635BFF]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
                  Service category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#635BFF]"
                >
                  {CATEGORY_NAMES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
                  Location (Benin City)
                </label>
                <input
                  type="text"
                  required
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#635BFF]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
                  Your budget (optional, ₦)
                </label>
                <input
                  type="number"
                  min={500}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-mono-nums focus:outline-none focus:ring-2 focus:ring-[#635BFF]"
                  placeholder="Optional"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A1B25] mb-1.5">
                  Urgency
                </label>
                <select
                  value={urgency}
                  onChange={(e) => setUrgency(e.target.value as UrgencyLevel)}
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#635BFF]"
                >
                  {URGENCY_LEVELS.map((lvl) => (
                    <option key={lvl} value={lvl}>
                      {lvl}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {additionalQuestions.length > 0 && (
              <div className="bg-[#F6F7FB] rounded-xl p-4 text-xs space-y-1.5">
                <div className="font-semibold text-[#1A1B25]">
                  Helpful details workers may ask about:
                </div>
                <ul className="list-disc list-inside text-[#6B7280] space-y-1">
                  {additionalQuestions.map((q, idx) => (
                    <li key={idx}>{q}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* AI Estimate section — optional & refreshable */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#1A1B25]">
                  Provisional Price Guidance
                </span>
                <div className="flex items-center gap-3 text-xs">
                  <button
                    type="button"
                    onClick={handleRefreshEstimate}
                    className="font-semibold text-[#635BFF] hover:text-[#4A44C6]"
                  >
                    {estimate ? 'Recalculate estimate' : 'Get indicative estimate'}
                  </button>
                  {estimate && (
                    <button
                      type="button"
                      onClick={() => setSkipEstimate((s) => !s)}
                      className="text-[#6B7280] hover:text-[#1A1B25]"
                    >
                      {skipEstimate ? 'Include AI estimate' : 'Publish without AI estimate'}
                    </button>
                  )}
                </div>
              </div>

              {estimate && !skipEstimate && <PriceEstimateCard estimate={estimate} />}
            </div>

            <label className="flex items-start gap-3 p-4 rounded-xl bg-[#F6F7FB] border border-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmedAccurate}
                onChange={(e) => setConfirmedAccurate(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#635BFF] focus:ring-[#635BFF]"
              />
              <span className="text-xs text-[#1A1B25] leading-relaxed">
                I confirm these job details are accurate and understand that any AI price estimate is provisional guidance rather than a fixed quote. My phone number will stay hidden until I accept an offer and complete the booking deposit.
              </span>
            </label>

            <div className="flex justify-end gap-3">
              <button
                type="submit"
                disabled={publishing || !confirmedAccurate}
                className="px-6 py-2.5 rounded-lg bg-[#635BFF] hover:bg-[#4A44C6] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                {publishing ? 'Publishing job...' : 'Confirm & Publish Job'}
              </button>
            </div>
          </form>
        )}
      </div>
    </AppShell>
  );
}
