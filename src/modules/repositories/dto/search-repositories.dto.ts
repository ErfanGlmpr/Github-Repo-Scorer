import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsISO8601,
  IsOptional,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Validated query parameters for GET /repositories.
 */
export class SearchRepositoriesDto {
  @ApiProperty({
    description: 'Programming language to filter repositories by',
    example: 'typescript',
  })
  @IsString()
  @IsNotEmpty({ message: 'language is required' })
  language!: string;

  @ApiProperty({
    description: 'Return only repositories created after this ISO 8601 date',
    example: '2026-01-01',
  })
  @IsISO8601(
    {},
    { message: 'created_after must be a valid ISO 8601 date string' },
  )
  @IsNotEmpty({ message: 'created_after is required' })
  created_after!: string;

  @ApiPropertyOptional({
    description: 'Page number for pagination',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Number of results per page',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
