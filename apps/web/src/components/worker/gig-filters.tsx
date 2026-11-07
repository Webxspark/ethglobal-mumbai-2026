"use client";

import { parseDate } from "@internationalized/date";
import {
  Calendar,
  DateField,
  DatePicker,
  Input,
  Label,
  NumberField,
  SearchField,
  TextField,
} from "@heroui/react";
import { SelectField } from "@/components/ui/select-field";
import { TagInput } from "@/components/ui/tag-input";
import {
  STATUS_OPTIONS,
  SORT_OPTIONS,
  type GigBoardFilters,
} from "@/lib/gig-filters";

type Props = {
  value: GigBoardFilters;
  onChange: (next: GigBoardFilters) => void;
  categories: string[];
};

function toDateValue(raw: string) {
  if (!raw.trim()) return null;
  try {
    // accept YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return parseDate(raw.slice(0, 10));
  } catch {
    /* ignore */
  }
  return null;
}

export function GigFilters({ value, onChange, categories }: Props) {
  function patch(partial: Partial<GigBoardFilters>) {
    onChange({ ...value, ...partial });
  }

  const dateValue = toDateValue(value.deadlineBefore);

  return (
    <div className="space-y-3" data-testid="gig-filters">
      <div className="flex flex-wrap gap-2">
        <SelectField
          aria-label="Status"
          value={value.status}
          onChange={(id) => patch({ status: id })}
          options={STATUS_OPTIONS.map((o) => ({
            id: o.value,
            label: o.label,
          }))}
        />
        <SelectField
          aria-label="Sort"
          value={value.sort}
          onChange={(id) =>
            patch({ sort: id as GigBoardFilters["sort"] })
          }
          options={SORT_OPTIONS.map((o) => ({
            id: o.value,
            label: o.label,
          }))}
        />
        <SelectField
          aria-label="Category"
          value={value.category || "ALL"}
          onChange={(id) =>
            patch({ category: id === "ALL" ? "" : id })
          }
          options={[
            { id: "ALL", label: "All categories" },
            ...categories.map((c) => ({ id: c, label: c })),
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <NumberField
          className="w-full"
          fullWidth
          minValue={0}
          value={
            value.rewardMin.trim() === ""
              ? NaN
              : Number.parseFloat(value.rewardMin)
          }
          onChange={(n) =>
            patch({
              rewardMin: Number.isFinite(n) ? String(n) : "",
            })
          }
          aria-label="Min reward HBAR"
        >
          <Label>Min HBAR</Label>
          <NumberField.Group className="w-full">
            <NumberField.Input
              className="h-8 w-full font-mono text-[12px] tabular-nums"
              placeholder="0"
            />
          </NumberField.Group>
        </NumberField>

        <NumberField
          className="w-full"
          fullWidth
          minValue={0}
          value={
            value.rewardMax.trim() === ""
              ? NaN
              : Number.parseFloat(value.rewardMax)
          }
          onChange={(n) =>
            patch({
              rewardMax: Number.isFinite(n) ? String(n) : "",
            })
          }
          aria-label="Max reward HBAR"
        >
          <Label>Max HBAR</Label>
          <NumberField.Group className="w-full">
            <NumberField.Input
              className="h-8 w-full font-mono text-[12px] tabular-nums"
              placeholder="—"
            />
          </NumberField.Group>
        </NumberField>

        <DatePicker
          className="w-full"
          name="deadline"
          value={dateValue}
          onChange={(d) =>
            patch({ deadlineBefore: d ? d.toString() : "" })
          }
        >
          <Label>Deadline before</Label>
          <DateField.Group fullWidth className="h-8">
            <DateField.Input>
              {(segment) => <DateField.Segment segment={segment} />}
            </DateField.Input>
            <DateField.Suffix>
              <DatePicker.Trigger>
                <DatePicker.TriggerIndicator />
              </DatePicker.Trigger>
            </DateField.Suffix>
          </DateField.Group>
          <DatePicker.Popover>
            <Calendar aria-label="Deadline before">
              <Calendar.Header>
                <Calendar.YearPickerTrigger>
                  <Calendar.YearPickerTriggerHeading />
                  <Calendar.YearPickerTriggerIndicator />
                </Calendar.YearPickerTrigger>
                <Calendar.NavButton slot="previous" />
                <Calendar.NavButton slot="next" />
              </Calendar.Header>
              <Calendar.Grid>
                <Calendar.GridHeader>
                  {(day) => (
                    <Calendar.HeaderCell>{day}</Calendar.HeaderCell>
                  )}
                </Calendar.GridHeader>
                <Calendar.GridBody>
                  {(date) => <Calendar.Cell date={date} />}
                </Calendar.GridBody>
              </Calendar.Grid>
              <Calendar.YearPickerGrid>
                <Calendar.YearPickerGridBody>
                  {({ year }) => <Calendar.YearPickerCell year={year} />}
                </Calendar.YearPickerGridBody>
              </Calendar.YearPickerGrid>
            </Calendar>
          </DatePicker.Popover>
        </DatePicker>

        <TextField
          className="w-full"
          fullWidth
          value={value.poster}
          onChange={(v) => patch({ poster: v })}
          aria-label="Poster agent"
        >
          <Label>Poster agent</Label>
          <Input
            className="h-8 text-[12px]"
            variant="secondary"
            placeholder="0x… / agent"
          />
        </TextField>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_minmax(0,14rem)]">
        <SearchField
          className="w-full"
          fullWidth
          value={value.q}
          onChange={(v) => patch({ q: v })}
          aria-label="Search"
        >
          <Label>Search</Label>
          <SearchField.Group className="h-8 w-full">
            <SearchField.SearchIcon />
            <SearchField.Input
              className="text-[12px]"
              placeholder="Title, tags…"
            />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>

        <TagInput
          value={value.tags}
          onChange={(tags) => patch({ tags })}
        />
      </div>
    </div>
  );
}
